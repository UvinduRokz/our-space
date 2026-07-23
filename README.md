# Thinking of You

A private two-person app. A split heart you can tap to let the other know
you're thinking of them, plus a few small co-op activities (Wordle, a
letter-finding word game, a shared drawing canvas), a shared history/recap
of everything you've done together, and a little profile screen to set what
you call each other.

## How it works

- **Live sync (Socket.IO):** while you're both on the page, taps and game
  moves stream to the other screen instantly.
- **Push notification (Web Push / VAPID):** if the other person isn't on the
  page, they get a real push notification instead — works even if their
  browser/app is fully closed.
- **Login:** no passwords — you each log in by typing your own name (set via
  `BOY_NAME` / `GIRL_NAME` in `.env`, case-insensitive). Typing the boy's name
  logs you in as "blue," the girl's name as "pink."
- **Activities:** Wordle Together (shared board, turns alternate, your
  partner watches you type live before you submit), Letter Hunt (find 10
  words together from 5 shared letters), and Draw Together (a canvas split
  down the middle, each of you draws on your own half live). None of these
  are playable solo — each is gated behind a "waiting for your partner"
  overlay until they're in that same activity.
- **Our History:** every tap, Wordle result, found word, and finished drawing
  is logged to a small local JSON file, with a recap view (totals + a
  timeline) under Activities → Our History.
- **Profile:** tap the 👤 icon on the heart screen to set what you call your
  partner (defaults to "babe") — used throughout the app's notifications and
  status text.
- **Music:** tap the 🎵 icon for a shared music player — playback is
  **synced** between you two (same track, same position, play/pause both
  apply to both screens), while volume stays local to each device. Starts
  with two simple original ambient loops (no real songs are bundled — real
  music is copyrighted, so upload your own MP3s from the Music screen to
  build out the shared library).
- **Sound effects:** short synthesized chimes (no audio files — generated
  live via the Web Audio API) on taps, Wordle results, and Hunt finds.
  Toggle per-device from the Profile screen.

## Setup

1. Install dependencies:
   ```
   npm install
   ```

2. Generate VAPID keys (needed for push notifications):
   ```
   npm run genkeys
   ```

3. Copy `.env.example` to `.env` and fill in:
   - `BOY_NAME` / `GIRL_NAME` — the two login names (case-insensitive)
   - `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` — from step 2
   - `CONTACT_EMAIL` — used in the VAPID subject, any address is fine
   - `MONGODB_URI` / `MONGODB_DB_NAME` — from a free MongoDB Atlas cluster
   - `CLOUDINARY_CLOUD_NAME` / `CLOUDINARY_API_KEY` / `CLOUDINARY_API_SECRET`
     — from a free Cloudinary account
   
   See [Data storage](#data-storage) below for details on the last two.

4. Run it:
   ```
   npm start
   ```
   Visit `http://localhost:3000`. Service workers/push work on `localhost`
   without HTTPS, so this is fine for local testing on one machine.

## Getting it onto both phones

Push notifications and installable PWAs require **HTTPS** on a real device
(localhost is the only exception). Easiest free options:

- **Render.com** — connect this folder as a GitHub repo, create a free Web
  Service, set the env vars from `.env` in its dashboard, deploy. You get a
  `https://your-app.onrender.com` URL automatically.
- **Fly.io / Railway** — similar flow, both have free/cheap tiers for a
  single small Node service.

Once deployed:
1. Open the URL on your phone, type your name to log in.
2. Allow notifications when prompted.
3. "Add to Home Screen" from the browser share menu so it opens like an app.
4. Repeat on their phone, with their name.

## Data storage

Structured data lives in MongoDB Atlas (one collection each for
subscriptions, profiles, history, drawings, music, musicDefault, and
playlists); uploaded/generated media (saved drawings, uploaded MP3s, the two
generated ambient `.wav` loops) lives in Cloudinary. Neither depends on the
server's own disk, so redeploying (even on a host with an ephemeral
filesystem, like Render's free tier) doesn't lose anything.

Set these in `.env` (see `.env.example`):
- `MONGODB_URI` / `MONGODB_DB_NAME` — an Atlas connection string and the
  database name to use (use a different `MONGODB_DB_NAME` for local dev vs
  prod so testing never touches real data)
- `CLOUDINARY_CLOUD_NAME` / `CLOUDINARY_API_KEY` / `CLOUDINARY_API_SECRET` —
  from your Cloudinary dashboard's Account Details panel

`history` is capped at the most recent 5000 events via a MongoDB capped
collection (created automatically on first boot) — oldest events are
evicted automatically, no app-side logic needed.

## Notes

- Only two identities (`blue`/`pink`) exist by design — there's no
  multi-user support, intentionally.
- Custom app icon: drop `icon-192.png` / `icon-512.png` into `public/` and
  reference them in `public/manifest.json` under `icons` if you want a nicer
  home-screen icon than the browser default.
