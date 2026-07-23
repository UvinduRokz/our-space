require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const webpush = require('web-push');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const { MongoClient } = require('mongodb');
const { v2: cloudinary } = require('cloudinary');
const { WORDLE_WORDS, DICTIONARY } = require('./server/words');
const { ensureBuiltinTracks } = require('./server/generate-music');

const DICTIONARY_SET = new Set(DICTIONARY);

const SIDES = ['blue', 'pink'];
const BOY_NAME = process.env.BOY_NAME || 'Uvindu';
const GIRL_NAME = process.env.GIRL_NAME || 'Tharushi';
const NAME_TO_SIDE = {
  [BOY_NAME.trim().toLowerCase()]: 'blue',
  [GIRL_NAME.trim().toLowerCase()]: 'pink',
};
const HISTORY_MAX = 5000;
const BEAR_OPTIONS = ['good-luck-bear', 'grumpy-bear', 'share-bear', 'tenderheart-bear', 'bedtime-bear', 'cheer-bear', 'funshine-bear'];
const DEFAULT_PROFILE = { partnerNickname: 'babe', bear: 'tenderheart-bear' };
const MAX_DRAWING_BYTES = 2 * 1024 * 1024;
const MAX_MUSIC_BYTES = 15 * 1024 * 1024;
const MUSIC_MIME_TYPES = ['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav'];

if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) {
  console.error('Missing VAPID keys in .env — run "npm run genkeys" and paste them in.');
  process.exit(1);
}
if (!process.env.MONGODB_URI || !process.env.MONGODB_DB_NAME) {
  console.error('Missing MONGODB_URI/MONGODB_DB_NAME in .env — see README for setup.');
  process.exit(1);
}
if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) {
  console.error('Missing CLOUDINARY_* keys in .env — see README for setup.');
  process.exit(1);
}

// Created once at module load and reused for the process lifetime — the
// driver's own connection pool is designed for exactly this (a long-running
// server), not a connect/disconnect-per-request pattern.
const mongoClient = new MongoClient(process.env.MONGODB_URI);
let dbPromise = null;
function connectDb() {
  if (!dbPromise) {
    dbPromise = mongoClient.connect().then(() => mongoClient.db(process.env.MONGODB_DB_NAME));
  }
  return dbPromise;
}

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

webpush.setVapidDetails(
  'mailto:' + (process.env.CONTACT_EMAIL || 'example@example.com'),
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

function sideForName(name) {
  return NAME_TO_SIDE[String(name || '').trim().toLowerCase()];
}

// blue/pink keyed objects, same shape every call site already expects —
// only the body changed (Mongo doc per side, _id: side) rather than one
// JSON file, so every caller just gains async/await.
async function loadSubs() {
  const db = await connectDb();
  const docs = await db.collection('subscriptions').find().toArray();
  const subs = {};
  for (const { _id, ...rest } of docs) subs[_id] = rest;
  return subs;
}
async function saveSubs(subs) {
  const db = await connectDb();
  const ops = SIDES.map((side) =>
    subs[side]
      ? { replaceOne: { filter: { _id: side }, replacement: { _id: side, ...subs[side] }, upsert: true } }
      : { deleteOne: { filter: { _id: side } } }
  );
  await db.collection('subscriptions').bulkWrite(ops);
}

async function loadProfiles() {
  const db = await connectDb();
  const docs = await db.collection('profiles').find().toArray();
  const profiles = {};
  for (const { _id, ...rest } of docs) profiles[_id] = rest;
  return profiles;
}
async function saveProfiles(profiles) {
  const db = await connectDb();
  const ops = SIDES.map((side) =>
    profiles[side]
      ? { replaceOne: { filter: { _id: side }, replacement: { _id: side, ...profiles[side] }, upsert: true } }
      : { deleteOne: { filter: { _id: side } } }
  );
  await db.collection('profiles').bulkWrite(ops);
}
async function getProfile(side) {
  const profiles = await loadProfiles();
  return { ...DEFAULT_PROFILE, ...(profiles[side] || {}) };
}

// A capped collection (created once at boot — see ensureHistoryCollection)
// enforces the HISTORY_MAX cap and insertion order natively, replacing the
// old load-full-array/push/splice/write-full-array dance entirely.
async function loadHistory() {
  const db = await connectDb();
  const docs = await db.collection('history').find().sort({ ts: 1 }).toArray();
  return docs.map(({ _id, ...rest }) => rest);
}
async function appendHistory(type, side, details) {
  const db = await connectDb();
  await db.collection('history').insertOne({ type, side, ts: Date.now(), details: details || {} });
}
async function ensureHistoryCollection(db) {
  const existing = await db.listCollections({ name: 'history' }).toArray();
  if (existing.length === 0) {
    // size is a required companion to capped:true — generously sized well
    // above what HISTORY_MAX small documents could ever total, so `max`
    // (the actual limit we care about) is always what triggers trimming.
    await db.createCollection('history', { capped: true, size: 5 * 1024 * 1024, max: HISTORY_MAX });
  }
}

// Array-shaped collections — save always fully replaces the collection's
// contents to match the given array, mirroring the old "rewrite the whole
// JSON file" behavior every call site already assumes. `id` <-> `_id` is
// the only field remapped so every caller keeps using `.id` unchanged.
// Every save*() call site follows the same "load array, mutate it in JS,
// save the whole array back" shape the old JSON files used — deleteMany+
// insertMany looked like the direct translation, but it isn't safe under
// concurrent writes: two near-simultaneous saves (very possible with two
// real partners both acting at once) can each try to re-insert the SAME
// pre-existing document, and MongoDB rejects the second insert as a
// duplicate key, crashing the request (confirmed — this took the whole
// server down during testing). Per-document upserts are idempotent even
// when two saves overlap on the same id, so this reruns the "collection
// must end up matching this array" logic as one bulk upsert pass plus a
// single delete for whatever's no longer present, instead of wipe-then-
// reinsert-everything.
async function syncArrayCollection(name, items) {
  const db = await connectDb();
  const col = db.collection(name);
  const ids = items.map((item) => item.id);
  if (items.length) {
    await col.bulkWrite(
      items.map(({ id, ...rest }) => ({
        replaceOne: { filter: { _id: id }, replacement: { _id: id, ...rest }, upsert: true },
      }))
    );
  }
  await col.deleteMany({ _id: { $nin: ids.length ? ids : [null] } });
}
// For adding ONE new item, prefer this over load-push-save(wholeArray):
// syncArrayCollection's final "delete anything not in this array" step is
// itself a race if two adds happen concurrently — confirmed in testing,
// where two overlapping saves each deleted the OTHER's freshly-inserted
// item because neither's snapshot knew about it. A single insertOne can't
// lose a concurrent sibling insert; it just succeeds independently.
async function insertArrayItem(name, item) {
  const db = await connectDb();
  const { id, ...rest } = item;
  await db.collection(name).insertOne({ _id: id, ...rest });
}

async function loadDrawings() {
  const db = await connectDb();
  const docs = await db.collection('drawings').find().sort({ ts: 1 }).toArray();
  return docs.map(({ _id, ...rest }) => ({ id: _id, ...rest }));
}
async function saveDrawings(drawings) {
  await syncArrayCollection('drawings', drawings);
}

async function loadMusic() {
  const db = await connectDb();
  const docs = await db.collection('music').find().sort({ ts: 1 }).toArray();
  return docs.map(({ _id, ...rest }) => ({ id: _id, ...rest }));
}
async function loadPlaylists() {
  const db = await connectDb();
  const docs = await db.collection('playlists').find().sort({ ts: 1 }).toArray();
  return docs.map(({ _id, ...rest }) => ({ id: _id, ...rest }));
}
async function savePlaylists(playlists) {
  await syncArrayCollection('playlists', playlists);
}
async function loadMusicDefault() {
  const db = await connectDb();
  const doc = await db.collection('musicDefault').findOne({ _id: 'default' });
  return doc ? { trackId: doc.trackId, playlistId: doc.playlistId } : { trackId: null, playlistId: null };
}
async function saveMusicDefault(def) {
  const db = await connectDb();
  await db.collection('musicDefault').replaceOne(
    { _id: 'default' },
    { _id: 'default', trackId: def.trackId, playlistId: def.playlistId },
    { upsert: true }
  );
}
async function saveMusic(tracks) {
  await syncArrayCollection('music', tracks);
}
// Called from the boot IIFE (awaited, after connectDb()) instead of here at
// module load — loadManifest/saveManifest are now Mongo-backed and async.

// Buffered in memory, not written to local disk — the upload handler pipes
// req.file.buffer straight to Cloudinary. fileFilter/size-limit behavior is
// unchanged from the old disk-storage config (those are multer-level
// concerns, independent of where the bytes end up).
const musicUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_MUSIC_BYTES },
  fileFilter: (req, file, cb) => {
    cb(null, MUSIC_MIME_TYPES.includes(file.mimetype));
  },
});

const app = express();
// 150mb to comfortably fit an /api/admin/restore payload (uploaded music
// files embedded as base64) — MAX_DRAWING_BYTES/MAX_MUSIC_BYTES below are
// the real per-item caps, enforced independently of this parser limit.
app.use(express.json({ limit: '150mb' }));
// No /music or /drawings static mounts — both now live on Cloudinary and
// carry their own absolute URL. /cursors stays: static app assets checked
// into the repo, not user data.
app.use('/cursors', express.static(path.join(__dirname, 'public', 'cursors')));
app.use(express.static(path.join(__dirname, 'client', 'dist')));

function requireAuth(req, res, next) {
  const side = sideForName(req.headers['x-auth-name']);
  if (!side) return res.status(401).json({ error: 'unauthorized' });
  req.side = side;
  next();
}

app.post('/api/verify', (req, res) => {
  const side = sideForName(req.body.name);
  if (!side) return res.status(401).json({ error: 'unauthorized' });
  res.json({ ok: true, side });
});

app.get('/api/config', (req, res) => {
  res.json({ vapidPublicKey: process.env.VAPID_PUBLIC_KEY, sides: SIDES });
});

app.post('/api/register', requireAuth, async (req, res) => {
  const { subscription } = req.body;
  const subs = await loadSubs();
  subs[req.side] = subscription;
  await saveSubs(subs);
  res.json({ ok: true });
});

app.get('/api/profile', requireAuth, async (req, res) => {
  res.json(await getProfile(req.side));
});

app.post('/api/profile', requireAuth, async (req, res) => {
  const partnerNickname = String((req.body && req.body.partnerNickname) || '').trim().slice(0, 30);
  const bear = BEAR_OPTIONS.includes(req.body && req.body.bear) ? req.body.bear : DEFAULT_PROFILE.bear;
  const profiles = await loadProfiles();
  profiles[req.side] = {
    partnerNickname: partnerNickname || DEFAULT_PROFILE.partnerNickname,
    bear,
  };
  await saveProfiles(profiles);
  res.json(await getProfile(req.side));
});

app.get('/api/history', requireAuth, async (req, res) => {
  res.json(await loadHistory());
});

app.get('/api/recap', requireAuth, async (req, res) => {
  const history = await loadHistory();
  const recap = {
    taps: 0,
    wordleWins: 0,
    wordleLosses: 0,
    huntWords: 0,
    huntCompletions: 0,
    drawSessions: 0,
    firstEventAt: history.length ? history[0].ts : null,
    totalEvents: history.length,
  };
  for (const ev of history) {
    if (ev.type === 'tap') recap.taps++;
    else if (ev.type === 'wordle_won') recap.wordleWins++;
    else if (ev.type === 'wordle_lost') recap.wordleLosses++;
    else if (ev.type === 'hunt_word') recap.huntWords++;
    else if (ev.type === 'hunt_completed') recap.huntCompletions++;
    else if (ev.type === 'draw_cleared') recap.drawSessions++;
  }
  res.json(recap);
});

app.post('/api/drawings', requireAuth, async (req, res) => {
  const image = req.body && req.body.image;
  const match = typeof image === 'string' && image.match(/^data:image\/png;base64,(.+)$/);
  if (!match) return res.status(400).json({ error: 'expected a data:image/png;base64 string' });

  const buffer = Buffer.from(match[1], 'base64');
  if (buffer.length > MAX_DRAWING_BYTES) {
    return res.status(413).json({ error: 'drawing too large' });
  }

  try {
    const id = crypto.randomUUID();
    // Cloudinary accepts the data URI directly — no local write needed.
    const uploaded = await cloudinary.uploader.upload(image, { folder: 'thinking-of-you/drawings', public_id: id });
    const record = { id, ts: Date.now(), side: req.side, cloudinaryUrl: uploaded.secure_url, cloudinaryPublicId: uploaded.public_id };
    await insertArrayItem('drawings', record);
    await appendHistory('drawing_saved', req.side, { id });

    res.json({ ...record, url: uploaded.secure_url });
  } catch (err) {
    console.error('[drawings] save failed:', err.message);
    res.status(502).json({ error: "couldn't save drawing" });
  }
});

app.get('/api/drawings', requireAuth, async (req, res) => {
  const drawings = (await loadDrawings())
    .map((d) => ({ ...d, url: d.cloudinaryUrl }))
    .sort((a, b) => b.ts - a.ts);
  res.json(drawings);
});

app.get('/api/music', requireAuth, async (req, res) => {
  const tracks = (await loadMusic())
    .map((t) => ({ ...t, url: t.cloudinaryUrl }))
    .sort((a, b) => a.ts - b.ts);
  res.json(tracks);
});

app.post('/api/music/upload', requireAuth, (req, res) => {
  musicUpload.single('file')(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message || 'upload failed' });
    if (!req.file) return res.status(400).json({ error: 'unsupported or missing file' });

    try {
      const title = String((req.body && req.body.title) || path.parse(req.file.originalname).name || 'Untitled').trim().slice(0, 60) || 'Untitled';
      const id = crypto.randomUUID();
      // Cloudinary categorizes non-image binary (audio included) under
      // resource_type: 'video', not 'raw' or 'audio' — a real API quirk.
      const uploaded = await new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          { resource_type: 'video', folder: 'thinking-of-you/music', public_id: id },
          (uploadErr, result) => (uploadErr ? reject(uploadErr) : resolve(result))
        );
        stream.end(req.file.buffer);
      });
      const record = { id, title, ts: Date.now(), side: req.side, builtin: false, cloudinaryUrl: uploaded.secure_url, cloudinaryPublicId: uploaded.public_id };
      await insertArrayItem('music', record);
      const tracks = await loadMusic();
      io.emit('music:tracks', tracks.map((t) => ({ ...t, url: t.cloudinaryUrl })));

      res.json({ ...record, url: uploaded.secure_url });
    } catch (uploadErr) {
      console.error('[music] upload failed:', uploadErr.message);
      res.status(502).json({ error: "couldn't upload — try again" });
    }
  });
});

app.get('/api/playlists', requireAuth, async (req, res) => {
  // stored array order IS the display/play order (reorderable via
  // /api/playlists/reorder below) — no longer forced to creation-time order
  res.json(await loadPlaylists());
});

app.post('/api/playlists/reorder', requireAuth, async (req, res) => {
  const orderedIds = Array.isArray(req.body && req.body.orderedIds) ? req.body.orderedIds : [];
  const playlists = await loadPlaylists();
  const byId = new Map(playlists.map((p) => [p.id, p]));
  const reordered = orderedIds.map((id) => byId.get(id)).filter(Boolean);
  // anything the client didn't mention (e.g. created by the partner in the
  // same instant) stays present, appended at the end, rather than dropped
  const missing = playlists.filter((p) => !orderedIds.includes(p.id));
  const next = [...reordered, ...missing];
  await savePlaylists(next);
  io.emit('music:playlists', next);
  res.json(next);
});

app.post('/api/playlists', requireAuth, async (req, res) => {
  const name = String((req.body && req.body.name) || '').trim().slice(0, 60);
  if (!name) return res.status(400).json({ error: 'name is required' });
  const trackIds = Array.isArray(req.body && req.body.trackIds) ? req.body.trackIds.filter((id) => typeof id === 'string') : [];
  const record = { id: crypto.randomUUID(), name, trackIds, ts: Date.now() };
  await insertArrayItem('playlists', record);
  io.emit('music:playlists', await loadPlaylists());
  res.json(record);
});

app.patch('/api/playlists/:id', requireAuth, async (req, res) => {
  const playlists = await loadPlaylists();
  const playlist = playlists.find((p) => p.id === req.params.id);
  if (!playlist) return res.status(404).json({ error: 'not found' });
  if (typeof (req.body && req.body.name) === 'string') {
    const name = req.body.name.trim().slice(0, 60);
    if (!name) return res.status(400).json({ error: 'name is required' });
    playlist.name = name;
  }
  if (Array.isArray(req.body && req.body.trackIds)) {
    playlist.trackIds = req.body.trackIds.filter((id) => typeof id === 'string');
  }
  await savePlaylists(playlists);
  io.emit('music:playlists', playlists);
  res.json(playlist);
});

app.delete('/api/playlists/:id', requireAuth, async (req, res) => {
  const playlists = await loadPlaylists();
  const idx = playlists.findIndex((p) => p.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'not found' });
  playlists.splice(idx, 1);
  await savePlaylists(playlists);
  io.emit('music:playlists', playlists);
  if (musicState.activePlaylistId === req.params.id) {
    musicState.activePlaylistId = null;
    io.emit('music:state', publicMusicState());
  }
  const def = await loadMusicDefault();
  if (def.playlistId === req.params.id) {
    const cleared = { trackId: null, playlistId: null };
    await saveMusicDefault(cleared);
    io.emit('music:default', cleared);
  }
  res.json({ ok: true });
});

const server = http.createServer(app);
const io = new Server(server);

// Each socket joins a room named after its side ('blue'/'pink'). Using rooms
// instead of a single side->socket.id map means multiple simultaneous
// connections from the same identity (e.g. phone + tablet both logged in as
// the same person) work correctly instead of clobbering each other.
function isOnline(side) {
  const room = io.sockets.adapter.rooms.get(side);
  return !!room && room.size > 0;
}

// ---- Activity presence: which screen each side is currently on ----
const ACTIVITIES = ['idle', 'activities', 'wordle', 'hunt', 'draw', 'profile', 'history', 'gallery', 'music'];
const activityState = { blue: 'idle', pink: 'idle' };

// ---- Wordle Together: shared co-op board, turns alternate ----
const WORDLE_MAX_GUESSES = 6;
let wordleState = null;

function newWordleGame() {
  wordleState = {
    target: WORDLE_WORDS[Math.floor(Math.random() * WORDLE_WORDS.length)],
    guesses: [],
    turn: 'blue',
    status: 'playing',
  };
}
newWordleGame();

function publicWordleState() {
  const revealTarget = wordleState.status !== 'playing';
  return {
    guesses: wordleState.guesses,
    turn: wordleState.turn,
    status: wordleState.status,
    maxGuesses: WORDLE_MAX_GUESSES,
    target: revealTarget ? wordleState.target : null,
  };
}

// ---- Letter Hunt: shared co-op word finding from 5 random letters ----
let huntState = null;

function randomHuntLetters() {
  const vowels = ['a', 'e', 'i', 'o', 'u'];
  const consonants = 'bcdfghjklmnpqrstvwxyz'.split('');
  function pick(pool, n) {
    const copy = [...pool];
    const picked = [];
    for (let i = 0; i < n; i++) {
      const idx = Math.floor(Math.random() * copy.length);
      picked.push(copy.splice(idx, 1)[0]);
    }
    return picked;
  }
  const letters = [...pick(vowels, 2), ...pick(consonants, 3)];
  for (let i = letters.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [letters[i], letters[j]] = [letters[j], letters[i]];
  }
  return letters;
}

function canFormWord(word, letters) {
  const avail = [...letters];
  for (const ch of word) {
    const idx = avail.indexOf(ch);
    if (idx === -1) return false;
    avail.splice(idx, 1);
  }
  return true;
}

function countPossibleWords(letters) {
  let count = 0;
  for (const w of DICTIONARY) {
    if (w.length >= 3 && w.length <= 5 && canFormWord(w, letters)) count++;
  }
  return count;
}

function newHunt() {
  // re-roll until the letters can actually form a decent number of words —
  // a raw random draw sometimes yields near-unplayable combos (e.g. ukjef)
  let letters;
  let tries = 0;
  do {
    letters = randomHuntLetters();
    tries++;
  } while (countPossibleWords(letters) < 6 && tries < 60);
  huntState = { letters, found: [], target: 10 };
}
newHunt();

// ---- Draw Together: split canvas, each side owns its half ----
let drawState = { blue: [], pink: [] };
let drawRedoStack = { blue: [], pink: [] };
const MAX_STROKES_PER_SIDE = 200;
// Chosen once per drawing (whoever picks first locks it for both sides —
// see draw:set-aspect-ratio) and reset back to null on draw:reset (the
// full-wipe button — draw:clear only wipes the clicking side), so a fresh
// drawing gets asked again. null means "not chosen yet."
const ASPECT_PRESETS = { portrait: 9 / 16, square: 1, landscape: 16 / 9 };
let drawAspectRatio = null;
let drawAspectPreset = null;

function clampDrawPoint(side, p) {
  const x = side === 'blue' ? Math.min(p.x, 0.5) : Math.max(p.x, 0.5);
  const y = Math.min(Math.max(p.y, 0), 1);
  return { x, y };
}

function sanitizeColor(color) {
  return typeof color === 'string' && /^#[0-9a-fA-F]{6}$/.test(color) ? color : '#1a1a1a';
}
function sanitizeWidth(width) {
  const n = Number(width);
  return Number.isFinite(n) ? Math.min(Math.max(n, 1), 40) : 4;
}
const DASH_STYLES = ['solid', 'dashed', 'dotted'];
function sanitizeDash(dash) {
  return DASH_STYLES.includes(dash) ? dash : 'solid';
}
const BRUSH_TYPES = ['pencil', 'brush', 'marker'];
function sanitizeBrushType(brush) {
  return BRUSH_TYPES.includes(brush) ? brush : 'pencil';
}
const SHAPE_TYPES = ['line', 'rect', 'ellipse', 'arrow', 'text', 'fill'];
function sanitizeText(text) {
  return typeof text === 'string' ? text.slice(0, 200) : '';
}
// Client-generated (not server-generated): the sender needs to know its own
// object's id immediately, with no round trip, so it can reference that
// object later for move/delete (Select tool). Since ids are only ever
// looked up within the creating side's own bucket, a malicious/duplicate id
// can only affect that side's own objects — never the partner's.
function sanitizeId(id) {
  return typeof id === 'string' && id.length > 0 && id.length <= 64 ? id : crypto.randomUUID();
}
function sanitizeFontSize(size) {
  const n = Number(size);
  return Number.isFinite(n) ? Math.min(Math.max(n, 10), 72) : 24;
}

// ---- Music Together: synced shared playback ----
// The server is the single source of truth for what's playing and where —
// same pattern as Draw Together's undo/redo. Clients never apply their own
// play/pause/seek locally; they wait for the broadcast echo, so both
// screens (and any extra devices on the same side) end up identical.
let musicState = { trackId: null, isPlaying: true, positionAtStart: 0, startedAt: null, activePlaylistId: null, repeatMode: 'track' };
// What plays on a fresh boot (this state resets whenever the server
// restarts) — prefers whichever song/playlist you two picked as the
// default (see music:setDefault), falling back to the first built-in
// ambient track if nothing's been chosen yet or the pick no longer exists.
// Called from the async boot sequence at the bottom of this file, after
// connectDb() resolves (loadMusicDefault() is Mongo-backed).
async function initMusicState() {
  const tracks = await loadMusic();
  const def = await loadMusicDefault();
  if (def.playlistId) {
    const playlist = (await loadPlaylists()).find((p) => p.id === def.playlistId);
    const firstTrack = playlist && playlist.trackIds.map((id) => tracks.find((t) => t.id === id)).find(Boolean);
    if (firstTrack) {
      musicState.activePlaylistId = def.playlistId;
      musicState.trackId = firstTrack.id;
    }
  } else if (def.trackId && tracks.some((t) => t.id === def.trackId)) {
    musicState.trackId = def.trackId;
  }
  if (!musicState.trackId) {
    const builtins = tracks.filter((t) => t.builtin).sort((a, b) => a.ts - b.ts);
    if (builtins.length) musicState.trackId = builtins[0].id;
  }
}

function currentMusicPosition() {
  if (!musicState.isPlaying || !musicState.startedAt) return musicState.positionAtStart;
  return musicState.positionAtStart + (Date.now() - musicState.startedAt) / 1000;
}
function publicMusicState() {
  return { ...musicState, position: currentMusicPosition(), serverNow: Date.now() };
}
function selectTrack(trackId, extra) {
  musicState = { ...musicState, trackId, isPlaying: true, positionAtStart: 0, startedAt: Date.now(), ...extra };
}
// The list next/previous/repeat cycle through: the active playlist's tracks
// (in playlist order, skipping any since-deleted ids) if one is set,
// otherwise every track sorted by upload time — same as before playlists existed.
async function activeTrackList() {
  const tracks = await loadMusic();
  if (musicState.activePlaylistId) {
    const playlists = await loadPlaylists();
    const playlist = playlists.find((p) => p.id === musicState.activePlaylistId);
    if (playlist) {
      return playlist.trackIds.map((id) => tracks.find((t) => t.id === id)).filter(Boolean);
    }
  }
  return tracks.sort((a, b) => a.ts - b.ts);
}
async function neighborTrackId(offset) {
  const tracks = await activeTrackList();
  if (!tracks.length) return null;
  const idx = tracks.findIndex((t) => t.id === musicState.trackId);
  const nextIdx = ((idx === -1 ? 0 : idx) + offset + tracks.length) % tracks.length;
  return tracks[nextIdx].id;
}

function evaluateGuess(guess, target) {
  const result = new Array(5).fill('absent');
  const targetChars = target.split('');
  const guessChars = guess.split('');
  const used = new Array(5).fill(false);
  for (let i = 0; i < 5; i++) {
    if (guessChars[i] === targetChars[i]) {
      result[i] = 'correct';
      used[i] = true;
    }
  }
  for (let i = 0; i < 5; i++) {
    if (result[i] === 'correct') continue;
    const idx = targetChars.findIndex((c, j) => c === guessChars[i] && !used[j]);
    if (idx !== -1) {
      result[i] = 'present';
      used[idx] = true;
    }
  }
  return result;
}

io.use((socket, next) => {
  const side = sideForName(socket.handshake.auth && socket.handshake.auth.name);
  if (!side) return next(new Error('unauthorized'));
  socket.side = side;
  next();
});

io.on('connection', (socket) => {
  socket.join(socket.side);
  io.emit('presence', { online: SIDES.filter(isOnline) });

  // let the newly-connected client know where their partner already is
  const otherSideOnConnect = SIDES.find((s) => s !== socket.side);
  socket.emit('activity:state', { side: otherSideOnConnect, activity: activityState[otherSideOnConnect] });

  socket.on('activity:update', async (data) => {
    const activity = ACTIVITIES.includes(data && data.activity) ? data.activity : 'idle';
    const prev = activityState[socket.side];
    activityState[socket.side] = activity;

    const otherSide = SIDES.find((s) => s !== socket.side);
    const otherIsOnline = isOnline(otherSide);
    if (otherIsOnline) io.to(otherSide).emit('activity:state', { side: socket.side, activity });

    // ping the partner only on the moment someone *opens* the activities
    // menu, not on every screen change within it — avoids notification spam
    if (prev !== 'activities' && activity === 'activities') {
      if (otherIsOnline) {
        io.to(otherSide).emit('activity:ping', { side: socket.side });
      } else {
        const subs = await loadSubs();
        const sub = subs[otherSide];
        if (sub) {
          const payload = JSON.stringify({
            title: `${(await getProfile(otherSide)).partnerNickname} wants to play together! 🎮`,
            body: 'Open the app to join an activity',
          });
          webpush.sendNotification(sub, payload).catch(async (err) => {
            if (err.statusCode === 404 || err.statusCode === 410) {
              delete subs[otherSide];
              await saveSubs(subs);
            }
          });
        }
      }
    }
  });

  socket.on('tap', async (data) => {
    const side = socket.side;
    const otherSide = SIDES.find((s) => s !== side);
    const xFrac = data && typeof data.xFrac === 'number' ? data.xFrac : undefined;
    const yFrac = data && typeof data.yFrac === 'number' ? data.yFrac : undefined;
    await appendHistory('tap', side, {});

    if (isOnline(otherSide)) {
      io.to(otherSide).emit('tap', { side, xFrac, yFrac });
    } else {
      const subs = await loadSubs();
      const sub = subs[otherSide];
      if (sub) {
        const payload = JSON.stringify({
          title: `${(await getProfile(otherSide)).partnerNickname} is thinking of you 💕`,
          body: 'Tap to open and send one back',
        });
        try {
          await webpush.sendNotification(sub, payload);
        } catch (err) {
          if (err.statusCode === 404 || err.statusCode === 410) {
            delete subs[otherSide];
            await saveSubs(subs);
          }
        }
      }
    }
  });

  socket.on('wordle:sync', () => {
    socket.emit('wordle:state', publicWordleState());
  });

  socket.on('wordle:new', () => {
    newWordleGame();
    io.emit('wordle:state', publicWordleState());
  });

  socket.on('wordle:type', (data) => {
    if (!wordleState || wordleState.status !== 'playing') return;
    if (socket.side !== wordleState.turn) return;
    const clean = String((data && data.text) || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 5);
    const otherSide = SIDES.find((s) => s !== socket.side);
    if (isOnline(otherSide)) io.to(otherSide).emit('wordle:typing', { text: clean });
  });

  socket.on('wordle:guess', async (data) => {
    if (!wordleState || wordleState.status !== 'playing') return;
    if (socket.side !== wordleState.turn) return;
    const clean = String((data && data.word) || '').toLowerCase().replace(/[^a-z]/g, '');
    if (clean.length !== 5) return;
    const result = evaluateGuess(clean, wordleState.target);
    wordleState.guesses.push({ word: clean, result, by: socket.side });
    if (clean === wordleState.target) {
      wordleState.status = 'won';
      await appendHistory('wordle_won', socket.side, { word: wordleState.target, guesses: wordleState.guesses.length });
    } else if (wordleState.guesses.length >= WORDLE_MAX_GUESSES) {
      wordleState.status = 'lost';
      await appendHistory('wordle_lost', socket.side, { word: wordleState.target, guesses: wordleState.guesses.length });
    } else {
      wordleState.turn = SIDES.find((s) => s !== socket.side);
    }
    io.emit('wordle:state', publicWordleState());
  });

  socket.on('hunt:sync', () => {
    socket.emit('hunt:state', huntState);
  });

  socket.on('hunt:new', () => {
    newHunt();
    io.emit('hunt:state', huntState);
  });

  socket.on('hunt:submit', async (data) => {
    const word = String((data && data.word) || '').toLowerCase().replace(/[^a-z]/g, '');
    if (word.length < 3) {
      socket.emit('hunt:invalid', { reason: 'too short' });
      return;
    }
    if (huntState.found.some((f) => f.word === word)) {
      socket.emit('hunt:invalid', { reason: 'already found' });
      return;
    }
    if (!canFormWord(word, huntState.letters)) {
      socket.emit('hunt:invalid', { reason: "letters don't allow that word" });
      return;
    }
    if (!DICTIONARY_SET.has(word)) {
      socket.emit('hunt:invalid', { reason: 'not a recognized word' });
      return;
    }
    huntState.found.push({ word, by: socket.side });
    await appendHistory('hunt_word', socket.side, { word });
    if (huntState.found.length === huntState.target) {
      await appendHistory('hunt_completed', socket.side, { count: huntState.found.length });
    }
    io.emit('hunt:state', huntState);
  });

  socket.on('draw:sync', () => {
    socket.emit('draw:state', drawState);
    socket.emit('draw:aspect-ratio', { ratio: drawAspectRatio, preset: drawAspectPreset });
  });

  socket.on('draw:set-aspect-ratio', (data) => {
    const preset = data && data.preset;
    if (!Object.prototype.hasOwnProperty.call(ASPECT_PRESETS, preset)) return;
    if (drawAspectRatio !== null) return; // already chosen for this drawing — first pick wins
    drawAspectPreset = preset;
    drawAspectRatio = ASPECT_PRESETS[preset];
    io.emit('draw:aspect-ratio', { ratio: drawAspectRatio, preset: drawAspectPreset });
  });

  socket.on('draw:stroke-start', (data) => {
    const p = clampDrawPoint(socket.side, { x: Number(data && data.x) || 0, y: Number(data && data.y) || 0 });
    const color = sanitizeColor(data && data.color);
    const width = sanitizeWidth(data && data.width);
    const dash = sanitizeDash(data && data.dash);
    const erase = !!(data && data.erase);
    const id = sanitizeId(data && data.id);
    // brush texture/gradient are decorative "draw" concepts that don't make
    // sense for an eraser (a translucent or gradient destination-out stroke
    // would erase unevenly) — forced off server-side too, not just trusted
    // from the client, so a stale/buggy client can't send a broken erase.
    const brushType = erase ? 'pencil' : sanitizeBrushType(data && data.brushType);
    const gradient = erase ? false : !!(data && data.gradient);
    const color2 = gradient ? sanitizeColor(data && data.color2) : undefined;
    const strokes = drawState[socket.side];
    const stroke = { id, type: 'freehand', color, width, dash, erase, brushType, points: [p] };
    if (gradient) {
      stroke.gradient = true;
      stroke.color2 = color2;
    }
    strokes.push(stroke);
    if (strokes.length > MAX_STROKES_PER_SIDE) strokes.shift();
    drawRedoStack[socket.side] = []; // a new stroke invalidates old redo history
    const otherSide = SIDES.find((s) => s !== socket.side);
    if (isOnline(otherSide)) {
      io.to(otherSide).emit('draw:stroke-start', { side: socket.side, id, point: p, color, width, dash, erase, brushType, gradient, color2 });
    }
  });

  socket.on('draw:stroke-points', (data) => {
    const strokes = drawState[socket.side];
    if (!strokes.length) return;
    const current = strokes[strokes.length - 1];
    const points = Array.isArray(data && data.points) ? data.points : [];
    const clamped = points
      .slice(0, 200)
      .map((p) => clampDrawPoint(socket.side, { x: Number(p.x) || 0, y: Number(p.y) || 0 }));
    current.points.push(...clamped);
    const otherSide = SIDES.find((s) => s !== socket.side);
    if (isOnline(otherSide)) io.to(otherSide).emit('draw:stroke-points', { side: socket.side, points: clamped });
  });

  // Pure signal, no payload beyond side — lets the OTHER client know a
  // freehand stroke is finished so it can do one settling redraw (fixes a
  // gradient stroke looking patchy while points are still streaming in,
  // since each arriving batch was colored against a gradient vector that
  // kept changing as the stroke grew).
  socket.on('draw:stroke-end', () => {
    const otherSide = SIDES.find((s) => s !== socket.side);
    if (isOnline(otherSide)) io.to(otherSide).emit('draw:stroke-end', { side: socket.side });
  });

  socket.on('draw:undo', () => {
    const strokes = drawState[socket.side];
    if (!strokes.length) return;
    const stroke = strokes.pop();
    drawRedoStack[socket.side].push(stroke);
    io.emit('draw:undo', { side: socket.side });
  });

  socket.on('draw:redo', () => {
    const redo = drawRedoStack[socket.side];
    if (!redo.length) return;
    const stroke = redo.pop();
    drawState[socket.side].push(stroke);
    io.emit('draw:redo', { side: socket.side, stroke });
  });

  // One-shot commit for shape tools (line/rect/ellipse/arrow/text) — unlike
  // freehand, these aren't streamed point-by-point, so they arrive as a
  // single fully-formed object.
  socket.on('draw:shape-commit', (data) => {
    const type = data && data.type;
    if (!SHAPE_TYPES.includes(type)) return;
    const rawPoints = Array.isArray(data && data.points) ? data.points : [];
    const expectedCount = type === 'text' || type === 'fill' ? 1 : 2;
    if (rawPoints.length !== expectedCount) return;
    const points = rawPoints.map((p) => clampDrawPoint(socket.side, { x: Number(p.x) || 0, y: Number(p.y) || 0 }));
    const id = sanitizeId(data && data.id);
    const obj = {
      id,
      type,
      color: sanitizeColor(data && data.color),
      width: sanitizeWidth(data && data.width),
      dash: sanitizeDash(data && data.dash),
      brushType: sanitizeBrushType(data && data.brushType),
      points,
    };
    if (data && data.gradient) {
      obj.gradient = true;
      obj.color2 = sanitizeColor(data.color2);
    }
    if (type === 'rect' || type === 'ellipse') obj.filled = !!(data && data.filled);
    if (type === 'text') {
      obj.text = sanitizeText(data && data.text);
      obj.fontSize = sanitizeFontSize(data && data.fontSize);
      if (!obj.text) return; // nothing worth committing
    }
    const strokes = drawState[socket.side];
    strokes.push(obj);
    if (strokes.length > MAX_STROKES_PER_SIDE) strokes.shift();
    drawRedoStack[socket.side] = [];
    const otherSide = SIDES.find((s) => s !== socket.side);
    if (isOnline(otherSide)) io.to(otherSide).emit('draw:shape-commit', { side: socket.side, object: obj });
  });

  // Searching only drawState[socket.side] is itself the ownership check —
  // each side's bucket only ever contains objects that side created, so an
  // id belonging to the partner's objects simply won't be found here.
  socket.on('draw:object-move', (data) => {
    const strokes = drawState[socket.side];
    const obj = strokes.find((s) => s.id === (data && data.id));
    if (!obj) return;
    const rawPoints = Array.isArray(data && data.points) ? data.points : [];
    const expectedCount = obj.type === 'text' || obj.type === 'fill' ? 1 : 2;
    if (rawPoints.length !== expectedCount) return;
    obj.points = rawPoints.map((p) => clampDrawPoint(socket.side, { x: Number(p.x) || 0, y: Number(p.y) || 0 }));
    const otherSide = SIDES.find((s) => s !== socket.side);
    if (isOnline(otherSide)) io.to(otherSide).emit('draw:object-move', { side: socket.side, id: obj.id, points: obj.points });
  });

  socket.on('draw:object-delete', (data) => {
    const strokes = drawState[socket.side];
    const index = strokes.findIndex((s) => s.id === (data && data.id));
    if (index === -1) return;
    const [removed] = strokes.splice(index, 1);
    const otherSide = SIDES.find((s) => s !== socket.side);
    if (isOnline(otherSide)) io.to(otherSide).emit('draw:object-delete', { side: socket.side, id: removed.id });
  });

  // Clears only the clicking side's own half — not the partner's, and not
  // the chosen aspect ratio (that's shared for the whole drawing). Scoped
  // to your own side already, so unlike finish/reset below it doesn't need
  // the other side's sign-off.
  socket.on('draw:clear', async () => {
    const side = socket.side;
    const hadStrokes = drawState[side].length > 0;
    if (hadStrokes) await appendHistory('draw_cleared', side, {});
    drawState[side] = [];
    drawRedoStack[side] = [];
    io.emit('draw:cleared', { side });
  });

  async function performDrawReset(requestingSide) {
    const hadStrokes = drawState.blue.length > 0 || drawState.pink.length > 0;
    if (hadStrokes) await appendHistory('draw_reset', requestingSide, {});
    drawState = { blue: [], pink: [] };
    drawRedoStack = { blue: [], pink: [] };
    drawAspectRatio = null;
    drawAspectPreset = null;
    io.emit('draw:cleared', { side: null });
    io.emit('draw:aspect-ratio', { ratio: null, preset: null });
  }

  // Finish/save and reset both affect (or end) the WHOLE shared drawing,
  // not just the clicking side's half — so unlike draw:clear, they go
  // through a request/respond round trip instead of firing immediately.
  // The requester never gets to unilaterally decide either one.
  socket.on('draw:finish-request', () => {
    const otherSide = SIDES.find((s) => s !== socket.side);
    if (!isOnline(otherSide)) return socket.emit('draw:finish-unavailable');
    io.to(otherSide).emit('draw:finish-requested', { side: socket.side });
  });
  socket.on('draw:finish-respond', ({ approved }) => {
    const otherSide = SIDES.find((s) => s !== socket.side); // the original requester
    if (isOnline(otherSide)) io.to(otherSide).emit('draw:finish-response', { approved: !!approved });
  });

  // The requester's client does the actual save (compositing + POST
  // /api/drawings) once approved, then reports the result here so BOTH
  // sides see the finished image, not just whoever clicked Finish.
  socket.on('draw:finish-saved', ({ url }) => {
    if (typeof url === 'string') io.emit('draw:finish-saved', { url });
  });

  // Whichever side closes the reveal first clears the drawing for BOTH —
  // the shape/aspect ratio stays put (unlike draw:reset) since you're
  // just moving on to a new drawing at the same canvas shape, not
  // starting over from the picker.
  socket.on('draw:finish-close', () => {
    drawState = { blue: [], pink: [] };
    drawRedoStack = { blue: [], pink: [] };
    io.emit('draw:cleared', { side: null });
    io.emit('draw:finish-closed');
  });

  socket.on('draw:reset-request', () => {
    const otherSide = SIDES.find((s) => s !== socket.side);
    if (!isOnline(otherSide)) return socket.emit('draw:reset-unavailable');
    io.to(otherSide).emit('draw:reset-requested', { side: socket.side });
  });
  socket.on('draw:reset-respond', async ({ approved }) => {
    const otherSide = SIDES.find((s) => s !== socket.side); // the original requester
    if (approved) await performDrawReset(otherSide);
    if (isOnline(otherSide)) io.to(otherSide).emit('draw:reset-response', { approved: !!approved });
  });

  socket.on('music:sync', async () => {
    socket.emit('music:state', publicMusicState());
    socket.emit('music:default', await loadMusicDefault());
  });

  // What plays next time the server restarts — persisted to Mongo since
  // musicState itself is memory-only. Exactly one of trackId/playlistId is
  // ever set; sending neither clears the default back to "no preference"
  // (falls back to the first built-in track on the next boot).
  socket.on('music:setDefault', async (data) => {
    const trackId = data && data.trackId;
    const playlistId = data && data.playlistId;
    if (playlistId && !(await loadPlaylists()).some((p) => p.id === playlistId)) return;
    if (trackId && !(await loadMusic()).some((t) => t.id === trackId)) return;
    const def = playlistId ? { trackId: null, playlistId } : trackId ? { trackId, playlistId: null } : { trackId: null, playlistId: null };
    await saveMusicDefault(def);
    io.emit('music:default', def);
  });

  socket.on('music:select', async (data) => {
    const trackId = data && data.trackId;
    if (!trackId || !(await loadMusic()).some((t) => t.id === trackId)) return;
    selectTrack(trackId);
    io.emit('music:state', publicMusicState());
  });

  socket.on('music:play', (data) => {
    if (!musicState.trackId) return;
    if (data && typeof data.position === 'number') musicState.positionAtStart = Math.max(0, data.position);
    else musicState.positionAtStart = currentMusicPosition();
    musicState.isPlaying = true;
    musicState.startedAt = Date.now();
    io.emit('music:state', publicMusicState());
  });

  socket.on('music:pause', () => {
    musicState.positionAtStart = currentMusicPosition();
    musicState.isPlaying = false;
    musicState.startedAt = null;
    io.emit('music:state', publicMusicState());
  });

  socket.on('music:seek', (data) => {
    const position = Number(data && data.position);
    if (!Number.isFinite(position)) return;
    musicState.positionAtStart = Math.max(0, position);
    if (musicState.isPlaying) musicState.startedAt = Date.now();
    io.emit('music:state', publicMusicState());
  });

  socket.on('music:next', async () => {
    const id = await neighborTrackId(1);
    if (id) selectTrack(id);
    io.emit('music:state', publicMusicState());
  });

  socket.on('music:previous', async () => {
    const id = await neighborTrackId(-1);
    if (id) selectTrack(id);
    io.emit('music:state', publicMusicState());
  });

  socket.on('music:selectPlaylist', async (data) => {
    const playlistId = data && data.playlistId ? data.playlistId : null;
    if (playlistId && !(await loadPlaylists()).some((p) => p.id === playlistId)) return;
    musicState.activePlaylistId = playlistId;
    const tracks = await activeTrackList();
    if (tracks.length) selectTrack(tracks[0].id);
    io.emit('music:state', publicMusicState());
  });

  socket.on('music:setRepeat', (data) => {
    const mode = data && data.mode;
    if (!['off', 'track', 'playlist'].includes(mode)) return;
    musicState.repeatMode = mode;
    io.emit('music:state', publicMusicState());
  });

  // Fired by whichever partner's <audio> element finishes first. Guarded on
  // trackId still matching the server's current track so the near-simultaneous
  // 'ended' from the OTHER partner's tab (same track, same moment) is a no-op
  // once the first one has already advanced/restarted state — otherwise we'd
  // double-skip.
  socket.on('music:ended', async (data) => {
    if (!data || data.trackId !== musicState.trackId) return;
    if (musicState.repeatMode === 'track') {
      selectTrack(musicState.trackId);
    } else if (musicState.repeatMode === 'playlist') {
      const id = await neighborTrackId(1);
      if (id) selectTrack(id);
    } else {
      const tracks = await activeTrackList();
      const idx = tracks.findIndex((t) => t.id === musicState.trackId);
      if (idx !== -1 && idx < tracks.length - 1) {
        selectTrack(tracks[idx + 1].id);
      } else {
        musicState.isPlaying = false;
        musicState.startedAt = null;
      }
    }
    io.emit('music:state', publicMusicState());
  });

  socket.on('disconnect', () => {
    // by this point the socket has already left its room, so isOnline()
    // correctly reflects whether any OTHER device on this side remains
    if (!isOnline(socket.side)) {
      activityState[socket.side] = 'idle';
      const otherSide = SIDES.find((s) => s !== socket.side);
      if (isOnline(otherSide)) io.to(otherSide).emit('activity:state', { side: socket.side, activity: 'idle' });
    }
    io.emit('presence', { online: SIDES.filter(isOnline) });
  });
});

// Migrating storage from sync fs calls to async Mongo/Cloudinary calls
// means a LOT of route/socket handlers can now reject (network blip, a bad
// write, etc.) — Express 4 doesn't catch async handler rejections on its
// own, and Node's default behavior for an unhandled rejection is to crash
// the entire process (confirmed painfully during testing — one bad
// request took down the server for both partners, not just that request).
// Handlers that return a response wrap their own await in try/catch (see
// /api/drawings, /api/music/upload) so failures become a proper HTTP
// error instead of a crash; this is the backstop for anything else.
process.on('unhandledRejection', (err) => {
  console.error('[unhandled rejection]', err);
});

// server.js is CommonJS (require, not import), so top-level await isn't
// available — an async IIFE is the boot sequence instead of converting the
// whole module system just for this. Mongo must be connected before
// initMusicState() (which reads musicDefault from it) and before the
// server starts accepting connections at all, since handlers assume
// musicState is already valid the moment a socket connects.
(async () => {
  const db = await connectDb();
  console.log('[mongo] connected');
  await ensureHistoryCollection(db);
  try {
    await cloudinary.api.ping();
    console.log('[cloudinary] connected');
  } catch (err) {
    console.error('[cloudinary] connection failed:', err.message);
  }
  await ensureBuiltinTracks({
    loadManifest: loadMusic,
    saveManifest: saveMusic,
    uploadBuffer: (wavBuffer, id) =>
      new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          { resource_type: 'video', folder: 'thinking-of-you/music', public_id: id },
          (err, result) => (err ? reject(err) : resolve({ cloudinaryUrl: result.secure_url, cloudinaryPublicId: result.public_id }))
        );
        stream.end(wavBuffer);
      }),
  });
  await initMusicState();

  const PORT = process.env.PORT || 3000;
  server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
})().catch((err) => {
  console.error('Fatal error during startup:', err);
  process.exit(1);
});
