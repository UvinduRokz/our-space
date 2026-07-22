(function () {
  let audioCtx = null;

  function ensureCtx() {
    if (!audioCtx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      audioCtx = new AC();
    }
    if (audioCtx.state === 'suspended') audioCtx.resume();
    return audioCtx;
  }

  function playTone(ctx, freq, startOffset, duration, opts) {
    opts = opts || {};
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = opts.type || 'sine';
    osc.frequency.value = freq;
    const now = ctx.currentTime + startOffset;
    const peak = opts.gain != null ? opts.gain : 0.2;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(peak, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + duration + 0.05);
  }

  // Short synthesized tones — no audio files, no copyright concerns.
  const RECIPES = {
    tap: (ctx) => {
      // a soft warm "bloom" — a gently staggered major chord instead of a
      // single flat beep, more fitting for a heart tap
      playTone(ctx, 523.25, 0, 0.35, { type: 'sine', gain: 0.14 }); // C5
      playTone(ctx, 659.25, 0.05, 0.4, { type: 'sine', gain: 0.12 }); // E5
      playTone(ctx, 783.99, 0.09, 0.45, { type: 'sine', gain: 0.07 }); // G5, soft sparkle
    },
    submit: (ctx) => {
      playTone(ctx, 520, 0, 0.08, { type: 'triangle', gain: 0.15 });
      playTone(ctx, 660, 0.09, 0.1, { type: 'triangle', gain: 0.15 });
    },
    win: (ctx) => {
      [523.25, 659.25, 783.99].forEach((f, i) => playTone(ctx, f, i * 0.12, 0.35, { type: 'sine', gain: 0.2 }));
    },
    lose: (ctx) => {
      [392.0, 293.66].forEach((f, i) => playTone(ctx, f, i * 0.15, 0.4, { type: 'sine', gain: 0.15 }));
    },
    found: (ctx) => {
      [880, 1046.5].forEach((f, i) => playTone(ctx, f, i * 0.08, 0.2, { type: 'sine', gain: 0.18 }));
    },
    complete: (ctx) => {
      [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => playTone(ctx, f, i * 0.11, 0.3, { type: 'sine', gain: 0.2 }));
    },
    ping: (ctx) => {
      playTone(ctx, 740, 0, 0.12, { type: 'sine', gain: 0.15 });
      playTone(ctx, 988, 0.1, 0.18, { type: 'sine', gain: 0.15 });
    },
  };

  window.SFX = {
    unlock() {
      ensureCtx();
    },
    isMuted() {
      return localStorage.getItem('sfx_muted') === '1';
    },
    setMuted(muted) {
      localStorage.setItem('sfx_muted', muted ? '1' : '0');
    },
    play(name) {
      if (window.SFX.isMuted()) return;
      const ctx = ensureCtx();
      if (!ctx) return;
      const recipe = RECIPES[name];
      if (recipe) recipe(ctx);
    },
  };
})();
