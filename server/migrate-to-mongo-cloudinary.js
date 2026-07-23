// One-off script: imports a /api/admin/backup JSON bundle (pulled from the
// still-disk-based prod deployment BEFORE this migration's code goes live)
// into MongoDB Atlas + Cloudinary. Run once, locally, never deployed.
//
// Usage: node server/migrate-to-mongo-cloudinary.js <path-to-backup.json>
//
// Connects to whatever MONGODB_URI/MONGODB_DB_NAME/CLOUDINARY_* are in .env
// — point .env at the PROD database before running this for real.
require('dotenv').config();
const fs = require('fs');
const { MongoClient } = require('mongodb');
const { v2: cloudinary } = require('cloudinary');

async function main() {
  const backupPath = process.argv[2];
  if (!backupPath) {
    console.error('Usage: node server/migrate-to-mongo-cloudinary.js <path-to-backup.json>');
    process.exit(1);
  }
  const data = JSON.parse(fs.readFileSync(backupPath, 'utf8'));

  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
  });

  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db(process.env.MONGODB_DB_NAME);
  console.log(`Migrating into database: ${process.env.MONGODB_DB_NAME}`);

  const counts = {};

  // subscriptions, profiles: side-keyed singletons.
  for (const [collectionName, obj] of [['subscriptions', data.subscriptions], ['profiles', data.profiles]]) {
    const entries = Object.entries(obj || {});
    if (entries.length) {
      const col = db.collection(collectionName);
      await col.bulkWrite(
        entries.map(([side, value]) => ({
          replaceOne: { filter: { _id: side }, replacement: { _id: side, ...value }, upsert: true },
        }))
      );
    }
    counts[collectionName] = entries.length;
  }

  // musicDefault: singleton.
  if (data.musicDefault) {
    await db.collection('musicDefault').replaceOne(
      { _id: 'default' },
      { _id: 'default', trackId: data.musicDefault.trackId || null, playlistId: data.musicDefault.playlistId || null },
      { upsert: true }
    );
    counts.musicDefault = 1;
  } else {
    counts.musicDefault = 0;
  }

  // history: bulk insert into the capped collection (must already exist —
  // the app's own boot sequence creates it, so start the app once against
  // this database first if this errors with "collection not capped").
  const history = Array.isArray(data.history) ? data.history : [];
  if (history.length) {
    await db.collection('history').insertMany(
      history.map(({ ts, type, side, details }) => ({ ts, type, side, details }))
    );
  }
  counts.history = history.length;

  // playlists: direct array -> documents, id -> _id.
  const playlists = Array.isArray(data.playlists) ? data.playlists : [];
  if (playlists.length) {
    await db.collection('playlists').bulkWrite(
      playlists.map(({ id, ...rest }) => ({
        replaceOne: { filter: { _id: id }, replacement: { _id: id, ...rest }, upsert: true },
      }))
    );
  }
  counts.playlists = playlists.length;

  // drawings: each manifest entry's file gets uploaded to Cloudinary, then
  // the document (with cloudinaryUrl/cloudinaryPublicId, no local filename)
  // gets inserted.
  const drawingsManifest = (data.drawings && data.drawings.manifest) || [];
  const drawingsFiles = (data.drawings && data.drawings.files) || {};
  let drawingsUploaded = 0;
  for (const d of drawingsManifest) {
    const b64 = drawingsFiles[d.filename];
    if (!b64) continue;
    const uploaded = await cloudinary.uploader.upload(`data:image/png;base64,${b64}`, { folder: 'thinking-of-you/drawings' });
    await db.collection('drawings').replaceOne(
      { _id: d.id },
      { _id: d.id, ts: d.ts, side: d.side, cloudinaryUrl: uploaded.secure_url, cloudinaryPublicId: uploaded.public_id },
      { upsert: true }
    );
    drawingsUploaded++;
  }
  counts.drawings = drawingsUploaded;

  // music: same pattern, non-builtin tracks only (builtins regenerate fresh
  // on this database's first boot via ensureBuiltinTracks()).
  const musicManifest = (data.music && data.music.manifest) || [];
  const musicFiles = (data.music && data.music.files) || {};
  let musicUploaded = 0;
  for (const t of musicManifest) {
    const b64 = musicFiles[t.filename];
    if (!b64) continue;
    const uploaded = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream({ resource_type: 'video', folder: 'thinking-of-you/music' }, (err, result) => {
        if (err) reject(err);
        else resolve(result);
      });
      stream.end(Buffer.from(b64, 'base64'));
    });
    await db.collection('music').replaceOne(
      { _id: t.id },
      { _id: t.id, title: t.title, ts: t.ts, side: t.side, builtin: false, cloudinaryUrl: uploaded.secure_url, cloudinaryPublicId: uploaded.public_id },
      { upsert: true }
    );
    musicUploaded++;
  }
  counts.music = musicUploaded;

  console.log('Migration summary:', counts);
  await client.close();
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
