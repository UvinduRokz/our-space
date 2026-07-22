// Generates a couple of simple original ambient loops so the music library
// isn't empty on first boot. Deliberately basic (a few summed sine tones
// with an envelope) — no attempt at real composed music, no dependencies,
// no copyrighted material.
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

const SAMPLE_RATE = 22050;

function encodeWav(samples, sampleRate) {
  const bytesPerSample = 2;
  const dataSize = samples.length * bytesPerSample;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(1, 22); // mono
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * bytesPerSample, 28); // byte rate
  buffer.writeUInt16LE(bytesPerSample, 32); // block align
  buffer.writeUInt16LE(16, 34); // bits per sample
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    buffer.writeInt16LE(Math.round(s * 32767), 44 + i * 2);
  }
  return buffer;
}

function renderTrack(renderFn, duration, sampleRate) {
  const numSamples = Math.floor(duration * sampleRate);
  const samples = new Float32Array(numSamples);
  for (let i = 0; i < numSamples; i++) {
    samples[i] = renderFn(i / sampleRate, duration);
  }
  return samples;
}

function fadeEnvelope(t, duration, fadeSeconds) {
  return Math.max(0, Math.min(1, t / fadeSeconds, (duration - t) / fadeSeconds));
}

function softPad(t, duration) {
  const freqs = [261.63, 329.63, 392.0, 493.88]; // C4 E4 G4 B4 (Cmaj7)
  let sample = 0;
  freqs.forEach((f, i) => {
    const lfo = 1 + 0.05 * Math.sin(2 * Math.PI * 0.13 * t + i);
    sample += Math.sin(2 * Math.PI * f * t) * 0.15 * lfo;
  });
  return sample * fadeEnvelope(t, duration, 2.5);
}

function gentleArpeggio(t, duration) {
  const notes = [261.63, 293.66, 329.63, 392.0, 440.0, 392.0, 329.63, 293.66]; // C D E G A G E D
  const noteLen = 0.45;
  const idx = Math.floor(t / noteLen) % notes.length;
  const tSinceNote = t % noteLen;
  const pluck = Math.sin(2 * Math.PI * notes[idx] * tSinceNote) * Math.exp(-tSinceNote * 3) * 0.25;
  const pad = Math.sin(2 * Math.PI * 130.81 * t) * 0.05; // soft C3 underneath
  return (pluck + pad) * fadeEnvelope(t, duration, 1.5);
}

const BUILTIN_TRACKS = [
  { title: 'Soft Pad', render: softPad, duration: 24 },
  { title: 'Gentle Arpeggio', render: gentleArpeggio, duration: 20 },
];

function ensureBuiltinTracks({ musicDir, loadManifest, saveManifest }) {
  const manifest = loadManifest();
  if (manifest.filter((m) => m.builtin).length >= BUILTIN_TRACKS.length) return;

  fs.mkdirSync(musicDir, { recursive: true });

  BUILTIN_TRACKS.forEach(({ title, render, duration }) => {
    if (manifest.some((m) => m.builtin && m.title === title)) return;
    const samples = renderTrack(render, duration, SAMPLE_RATE);
    const wav = encodeWav(samples, SAMPLE_RATE);
    const id = crypto.randomUUID();
    const filename = `${id}.wav`;
    fs.writeFileSync(path.join(musicDir, filename), wav);
    manifest.push({ id, title, filename, ts: Date.now(), side: null, builtin: true });
  });

  saveManifest(manifest);
}

module.exports = { ensureBuiltinTracks };
