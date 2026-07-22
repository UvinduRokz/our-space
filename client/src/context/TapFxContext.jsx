import { createContext, useContext, useEffect, useRef } from 'react';
import { useApp } from './AppContext.jsx';
import { initTapFX, triggerTapFX } from '../lib/tapfx.js';
import { playSfx, unlockSfx } from '../lib/sfx.js';

const TapFxContext = createContext(null);
const FX_COOLDOWN_MS = 450;

// Persistent, app-wide: the full-screen particle canvas lives here
// (mounted once at the app root, like MusicProvider's <audio>) so an
// incoming tap from your partner plays its effects regardless of which
// screen you're currently looking at — that's the point of a "thinking of
// you" surprise, it shouldn't require you to be on the main screen too.
export function TapFxProvider({ children }) {
  const { socket, side } = useApp();
  const canvasRef = useRef(null);
  const lastFxAtRef = useRef(0);

  useEffect(() => {
    if (canvasRef.current) initTapFX(canvasRef.current);
  }, []);

  // Resume/unlock the Web Audio context on the very first interaction
  // anywhere in the app — music/SFX playback later in the session rely on
  // this having happened once. Deliberately NOT { once: true }: a
  // suspended context (e.g. the OS backgrounding the tab on mobile) needs
  // re-resuming on the next interaction too, and unlockSfx() is a cheap
  // no-op once already unlocked.
  useEffect(() => {
    document.addEventListener('pointerdown', unlockSfx);
    return () => document.removeEventListener('pointerdown', unlockSfx);
  }, []);

  function fireFx(fxSide, flashX, flashY) {
    const color = fxSide === 'blue' ? '#4f8fff' : '#ff5fa8';
    // Fixed-fraction origin rather than reading the heart element's actual
    // position: the heart only exists in the DOM while MainScreen itself
    // is mounted, but a tap's effects should play no matter which screen
    // you're on right now.
    const x = window.innerWidth * (fxSide === 'blue' ? 0.3 : 0.7);
    const y = window.innerHeight * 0.35;
    triggerTapFX(x, y, color, fxSide);

    const fx = flashX != null ? flashX : window.innerWidth * (fxSide === 'blue' ? 0.25 : 0.75);
    const fy = flashY != null ? flashY : window.innerHeight * 0.5;
    document.body.style.setProperty('--flash-x', (fx / window.innerWidth) * 100 + '%');
    document.body.style.setProperty('--flash-y', (fy / window.innerHeight) * 100 + '%');
    document.body.style.setProperty('--flash-color', color);
    document.body.classList.remove('flashing');
    void document.body.offsetWidth; // restart the animation even if it's already mid-flash
    document.body.classList.add('flashing');
  }

  // A burst of rapid/queued taps (yours or theirs) should never stack up
  // and slam the screen with overlapping heavy animations at once — only
  // one plays per cooldown window, the rest are dropped.
  function tryFireFx(fxSide, flashX, flashY) {
    const now = performance.now();
    if (now - lastFxAtRef.current < FX_COOLDOWN_MS) return false;
    lastFxAtRef.current = now;
    fireFx(fxSide, flashX, flashY);
    return true;
  }

  useEffect(() => {
    if (!socket) return;
    function onTap({ side: tappedSide, xFrac, yFrac }) {
      const x = typeof xFrac === 'number' ? xFrac * window.innerWidth : null;
      const y = typeof yFrac === 'number' ? yFrac * window.innerHeight : null;
      tryFireFx(tappedSide, x, y);
      playSfx('tap');
    }
    socket.on('tap', onTap);
    return () => socket.off('tap', onTap);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socket]);

  // Called by MainScreen when the user taps their own heart. Fires local
  // FX immediately and emits to the partner; per earlier feedback, your
  // own tap doesn't play SFX for you — only the other person's tap does,
  // via the socket listener above.
  function sendTap(clientX, clientY) {
    if (!tryFireFx(side, clientX, clientY)) return;
    if (!socket) return;
    const xFrac = clientX / window.innerWidth;
    const yFrac = clientY / window.innerHeight;
    socket.volatile.emit('tap', { xFrac, yFrac });
  }

  return (
    <TapFxContext.Provider value={{ sendTap }}>
      <canvas ref={canvasRef} className="fx-canvas" />
      {children}
    </TapFxContext.Provider>
  );
}

export function useTapFx() {
  const ctx = useContext(TapFxContext);
  if (!ctx) throw new Error('useTapFx must be used within a TapFxProvider');
  return ctx;
}
