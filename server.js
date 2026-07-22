require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const webpush = require('web-push');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
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
const DATA_FILE = path.join(__dirname, 'subscriptions.json');
const PROFILES_FILE = path.join(__dirname, 'profiles.json');
const HISTORY_FILE = path.join(__dirname, 'history.json');
const HISTORY_MAX = 5000;
const BEAR_OPTIONS = ['good-luck-bear', 'grumpy-bear', 'share-bear', 'tenderheart-bear', 'bedtime-bear', 'cheer-bear', 'funshine-bear'];
const DEFAULT_PROFILE = { partnerNickname: 'babe', bear: 'tenderheart-bear' };
const DRAWINGS_FILE = path.join(__dirname, 'drawings.json');
const DRAWINGS_DIR = path.join(__dirname, 'public', 'drawings');
const MAX_DRAWING_BYTES = 2 * 1024 * 1024;
const MUSIC_FILE = path.join(__dirname, 'music.json');
const PLAYLISTS_FILE = path.join(__dirname, 'playlists.json');
const MUSIC_DIR = path.join(__dirname, 'public', 'music');
const MAX_MUSIC_BYTES = 15 * 1024 * 1024;
const MUSIC_MIME_TYPES = ['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav'];

if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) {
  console.error('Missing VAPID keys in .env — run "npm run genkeys" and paste them in.');
  process.exit(1);
}

webpush.setVapidDetails(
  'mailto:' + (process.env.CONTACT_EMAIL || 'example@example.com'),
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

function sideForName(name) {
  return NAME_TO_SIDE[String(name || '').trim().toLowerCase()];
}

function loadSubs() {
  if (!fs.existsSync(DATA_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch {
    return {};
  }
}
function saveSubs(subs) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(subs, null, 2));
}

function loadProfiles() {
  if (!fs.existsSync(PROFILES_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(PROFILES_FILE, 'utf8'));
  } catch {
    return {};
  }
}
function saveProfiles(profiles) {
  fs.writeFileSync(PROFILES_FILE, JSON.stringify(profiles, null, 2));
}
function getProfile(side) {
  const profiles = loadProfiles();
  return { ...DEFAULT_PROFILE, ...(profiles[side] || {}) };
}

function loadHistory() {
  if (!fs.existsSync(HISTORY_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
  } catch {
    return [];
  }
}
function appendHistory(type, side, details) {
  const history = loadHistory();
  history.push({ type, side, ts: Date.now(), details: details || {} });
  if (history.length > HISTORY_MAX) history.splice(0, history.length - HISTORY_MAX);
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2));
}

function loadDrawings() {
  if (!fs.existsSync(DRAWINGS_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(DRAWINGS_FILE, 'utf8'));
  } catch {
    return [];
  }
}
function saveDrawings(drawings) {
  fs.writeFileSync(DRAWINGS_FILE, JSON.stringify(drawings, null, 2));
}

function loadMusic() {
  if (!fs.existsSync(MUSIC_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(MUSIC_FILE, 'utf8'));
  } catch {
    return [];
  }
}
function loadPlaylists() {
  if (!fs.existsSync(PLAYLISTS_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(PLAYLISTS_FILE, 'utf8'));
  } catch {
    return [];
  }
}
function savePlaylists(playlists) {
  fs.writeFileSync(PLAYLISTS_FILE, JSON.stringify(playlists, null, 2));
}
function saveMusic(tracks) {
  fs.writeFileSync(MUSIC_FILE, JSON.stringify(tracks, null, 2));
}

ensureBuiltinTracks({ musicDir: MUSIC_DIR, loadManifest: loadMusic, saveManifest: saveMusic });

const musicUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      fs.mkdirSync(MUSIC_DIR, { recursive: true });
      cb(null, MUSIC_DIR);
    },
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname) || (file.mimetype === 'audio/wav' ? '.wav' : '.mp3');
      cb(null, `${crypto.randomUUID()}${ext}`);
    },
  }),
  limits: { fileSize: MAX_MUSIC_BYTES },
  fileFilter: (req, file, cb) => {
    cb(null, MUSIC_MIME_TYPES.includes(file.mimetype));
  },
});

const app = express();
app.use(express.json({ limit: '5mb' })); // saved drawings are base64 PNGs
app.use('/music', express.static(path.join(__dirname, 'public', 'music')));
app.use('/drawings', express.static(path.join(__dirname, 'public', 'drawings')));
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

app.post('/api/register', requireAuth, (req, res) => {
  const { subscription } = req.body;
  const subs = loadSubs();
  subs[req.side] = subscription;
  saveSubs(subs);
  res.json({ ok: true });
});

app.get('/api/profile', requireAuth, (req, res) => {
  res.json(getProfile(req.side));
});

app.post('/api/profile', requireAuth, (req, res) => {
  const partnerNickname = String((req.body && req.body.partnerNickname) || '').trim().slice(0, 30);
  const bear = BEAR_OPTIONS.includes(req.body && req.body.bear) ? req.body.bear : DEFAULT_PROFILE.bear;
  const profiles = loadProfiles();
  profiles[req.side] = {
    partnerNickname: partnerNickname || DEFAULT_PROFILE.partnerNickname,
    bear,
  };
  saveProfiles(profiles);
  res.json(getProfile(req.side));
});

app.get('/api/history', requireAuth, (req, res) => {
  res.json(loadHistory());
});

app.get('/api/recap', requireAuth, (req, res) => {
  const history = loadHistory();
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

app.post('/api/drawings', requireAuth, (req, res) => {
  const image = req.body && req.body.image;
  const match = typeof image === 'string' && image.match(/^data:image\/png;base64,(.+)$/);
  if (!match) return res.status(400).json({ error: 'expected a data:image/png;base64 string' });

  const buffer = Buffer.from(match[1], 'base64');
  if (buffer.length > MAX_DRAWING_BYTES) {
    return res.status(413).json({ error: 'drawing too large' });
  }

  fs.mkdirSync(DRAWINGS_DIR, { recursive: true });
  const id = crypto.randomUUID();
  const filename = `${id}.png`;
  fs.writeFileSync(path.join(DRAWINGS_DIR, filename), buffer);

  const record = { id, ts: Date.now(), side: req.side, filename };
  const drawings = loadDrawings();
  drawings.push(record);
  saveDrawings(drawings);
  appendHistory('drawing_saved', req.side, { id });

  res.json({ ...record, url: `/drawings/${filename}` });
});

app.get('/api/drawings', requireAuth, (req, res) => {
  const drawings = loadDrawings()
    .map((d) => ({ ...d, url: `/drawings/${d.filename}` }))
    .sort((a, b) => b.ts - a.ts);
  res.json(drawings);
});

app.get('/api/music', requireAuth, (req, res) => {
  const tracks = loadMusic()
    .map((t) => ({ ...t, url: `/music/${t.filename}` }))
    .sort((a, b) => a.ts - b.ts);
  res.json(tracks);
});

app.post('/api/music/upload', requireAuth, (req, res) => {
  musicUpload.single('file')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message || 'upload failed' });
    if (!req.file) return res.status(400).json({ error: 'unsupported or missing file' });

    const title = String((req.body && req.body.title) || path.parse(req.file.originalname).name || 'Untitled').trim().slice(0, 60) || 'Untitled';
    const record = { id: crypto.randomUUID(), title, filename: req.file.filename, ts: Date.now(), side: req.side, builtin: false };
    const tracks = loadMusic();
    tracks.push(record);
    saveMusic(tracks);
    io.emit('music:tracks', tracks.map((t) => ({ ...t, url: `/music/${t.filename}` })));

    res.json({ ...record, url: `/music/${record.filename}` });
  });
});

app.get('/api/playlists', requireAuth, (req, res) => {
  // stored array order IS the display/play order (reorderable via
  // /api/playlists/reorder below) — no longer forced to creation-time order
  res.json(loadPlaylists());
});

app.post('/api/playlists/reorder', requireAuth, (req, res) => {
  const orderedIds = Array.isArray(req.body && req.body.orderedIds) ? req.body.orderedIds : [];
  const playlists = loadPlaylists();
  const byId = new Map(playlists.map((p) => [p.id, p]));
  const reordered = orderedIds.map((id) => byId.get(id)).filter(Boolean);
  // anything the client didn't mention (e.g. created by the partner in the
  // same instant) stays present, appended at the end, rather than dropped
  const missing = playlists.filter((p) => !orderedIds.includes(p.id));
  const next = [...reordered, ...missing];
  savePlaylists(next);
  io.emit('music:playlists', next);
  res.json(next);
});

app.post('/api/playlists', requireAuth, (req, res) => {
  const name = String((req.body && req.body.name) || '').trim().slice(0, 60);
  if (!name) return res.status(400).json({ error: 'name is required' });
  const trackIds = Array.isArray(req.body && req.body.trackIds) ? req.body.trackIds.filter((id) => typeof id === 'string') : [];
  const record = { id: crypto.randomUUID(), name, trackIds, ts: Date.now() };
  const playlists = loadPlaylists();
  playlists.push(record);
  savePlaylists(playlists);
  io.emit('music:playlists', playlists);
  res.json(record);
});

app.patch('/api/playlists/:id', requireAuth, (req, res) => {
  const playlists = loadPlaylists();
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
  savePlaylists(playlists);
  io.emit('music:playlists', playlists);
  res.json(playlist);
});

app.delete('/api/playlists/:id', requireAuth, (req, res) => {
  const playlists = loadPlaylists();
  const idx = playlists.findIndex((p) => p.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'not found' });
  playlists.splice(idx, 1);
  savePlaylists(playlists);
  io.emit('music:playlists', playlists);
  if (musicState.activePlaylistId === req.params.id) {
    musicState.activePlaylistId = null;
    io.emit('music:state', publicMusicState());
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
const SHAPE_TYPES = ['line', 'rect', 'ellipse', 'arrow', 'text'];
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
{
  const builtins = loadMusic().filter((t) => t.builtin).sort((a, b) => a.ts - b.ts);
  if (builtins.length) musicState.trackId = builtins[0].id;
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
function activeTrackList() {
  const tracks = loadMusic();
  if (musicState.activePlaylistId) {
    const playlist = loadPlaylists().find((p) => p.id === musicState.activePlaylistId);
    if (playlist) {
      return playlist.trackIds.map((id) => tracks.find((t) => t.id === id)).filter(Boolean);
    }
  }
  return tracks.sort((a, b) => a.ts - b.ts);
}
function neighborTrackId(offset) {
  const tracks = activeTrackList();
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

  socket.on('activity:update', (data) => {
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
        const subs = loadSubs();
        const sub = subs[otherSide];
        if (sub) {
          const payload = JSON.stringify({
            title: `${getProfile(otherSide).partnerNickname} wants to play together! 🎮`,
            body: 'Open the app to join an activity',
          });
          webpush.sendNotification(sub, payload).catch((err) => {
            if (err.statusCode === 404 || err.statusCode === 410) {
              delete subs[otherSide];
              saveSubs(subs);
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
    appendHistory('tap', side, {});

    if (isOnline(otherSide)) {
      io.to(otherSide).emit('tap', { side, xFrac, yFrac });
    } else {
      const subs = loadSubs();
      const sub = subs[otherSide];
      if (sub) {
        const payload = JSON.stringify({
          title: `${getProfile(otherSide).partnerNickname} is thinking of you 💕`,
          body: 'Tap to open and send one back',
        });
        try {
          await webpush.sendNotification(sub, payload);
        } catch (err) {
          if (err.statusCode === 404 || err.statusCode === 410) {
            delete subs[otherSide];
            saveSubs(subs);
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

  socket.on('wordle:guess', (data) => {
    if (!wordleState || wordleState.status !== 'playing') return;
    if (socket.side !== wordleState.turn) return;
    const clean = String((data && data.word) || '').toLowerCase().replace(/[^a-z]/g, '');
    if (clean.length !== 5) return;
    const result = evaluateGuess(clean, wordleState.target);
    wordleState.guesses.push({ word: clean, result, by: socket.side });
    if (clean === wordleState.target) {
      wordleState.status = 'won';
      appendHistory('wordle_won', socket.side, { word: wordleState.target, guesses: wordleState.guesses.length });
    } else if (wordleState.guesses.length >= WORDLE_MAX_GUESSES) {
      wordleState.status = 'lost';
      appendHistory('wordle_lost', socket.side, { word: wordleState.target, guesses: wordleState.guesses.length });
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

  socket.on('hunt:submit', (data) => {
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
    appendHistory('hunt_word', socket.side, { word });
    if (huntState.found.length === huntState.target) {
      appendHistory('hunt_completed', socket.side, { count: huntState.found.length });
    }
    io.emit('hunt:state', huntState);
  });

  socket.on('draw:sync', () => {
    socket.emit('draw:state', drawState);
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
    const expectedCount = type === 'text' ? 1 : 2;
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
    const expectedCount = obj.type === 'text' ? 1 : 2;
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

  socket.on('draw:clear', () => {
    const hadStrokes = drawState.blue.length > 0 || drawState.pink.length > 0;
    if (hadStrokes) appendHistory('draw_cleared', socket.side, {});
    drawState = { blue: [], pink: [] };
    drawRedoStack = { blue: [], pink: [] };
    io.emit('draw:cleared');
  });

  socket.on('music:sync', () => {
    socket.emit('music:state', publicMusicState());
  });

  socket.on('music:select', (data) => {
    const trackId = data && data.trackId;
    if (!trackId || !loadMusic().some((t) => t.id === trackId)) return;
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

  socket.on('music:next', () => {
    const id = neighborTrackId(1);
    if (id) selectTrack(id);
    io.emit('music:state', publicMusicState());
  });

  socket.on('music:previous', () => {
    const id = neighborTrackId(-1);
    if (id) selectTrack(id);
    io.emit('music:state', publicMusicState());
  });

  socket.on('music:selectPlaylist', (data) => {
    const playlistId = data && data.playlistId ? data.playlistId : null;
    if (playlistId && !loadPlaylists().some((p) => p.id === playlistId)) return;
    musicState.activePlaylistId = playlistId;
    const tracks = activeTrackList();
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
  socket.on('music:ended', (data) => {
    if (!data || data.trackId !== musicState.trackId) return;
    if (musicState.repeatMode === 'track') {
      selectTrack(musicState.trackId);
    } else if (musicState.repeatMode === 'playlist') {
      const id = neighborTrackId(1);
      if (id) selectTrack(id);
    } else {
      const tracks = activeTrackList();
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

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
