import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useApp } from './AppContext.jsx';
import './MusicContext.css';

const MusicContext = createContext(null);

// Human hearing perceives loudness roughly logarithmically, but the slider
// position is linear — squaring the fraction tapers it so perceived
// loudness actually tracks slider position across the whole range instead
// of only dropping off in the last few pixels near the left edge.
function sliderToVolume(sliderValue) {
  const fraction = Math.min(1, Math.max(0, Number(sliderValue) / 100));
  return fraction * fraction;
}

// Server-told position, projected forward by however long it's been since
// that message arrived — server is authoritative, this is just a local
// estimate between updates.
export function expectedPosition(state) {
  if (!state || !state.isPlaying) return state ? state.position : 0;
  return state.position + (Date.now() - state.serverNow) / 1000;
}

// Persistent, app-wide: the <audio> element and its socket wiring live
// here (mounted once at the app root) so playback continues uninterrupted
// while the user browses other screens — mirrors the old app's
// MusicPlayer.init() being independent of screen navigation.
export function MusicProvider({ children }) {
  const { socket, apiGet, name } = useApp();
  const audioRef = useRef(null);
  const [tracks, setTracks] = useState([]);
  const [playlists, setPlaylists] = useState([]);
  const [lastState, setLastState] = useState(null);
  const [needsSyncTap, setNeedsSyncTap] = useState(false);
  const [volumeSlider, setVolumeSlider] = useState(() => {
    const saved = localStorage.getItem('music_volume');
    return saved !== null ? Number(saved) : 70;
  });

  // mirrors lastState for the stable 'ended' listener below, which needs
  // the LATEST state at the moment playback naturally finishes, not
  // whatever was captured when the socket-setup effect first ran
  const lastStateRef = useRef(null);
  useEffect(() => {
    lastStateRef.current = lastState;
  }, [lastState]);

  const refreshTracks = useCallback(async () => {
    try {
      const t = await apiGet('/api/music');
      setTracks(t);
      return t;
    } catch (err) {
      console.warn('[music] failed to load track list', err);
      return [];
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name]);

  const refreshPlaylists = useCallback(async () => {
    try {
      const p = await apiGet('/api/playlists');
      setPlaylists(p);
      return p;
    } catch (err) {
      console.warn('[music] failed to load playlists', err);
      return [];
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name]);

  // apply the saved/adjusted volume to the actual audio element whenever
  // the slider value changes (initial load included)
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const vol = sliderToVolume(volumeSlider);
    audio.volume = vol;
    audio.muted = vol === 0; // iOS Safari ignores .volume entirely; .muted is the only thing it respects
  }, [volumeSlider]);

  function setVolume(sliderValue) {
    setVolumeSlider(sliderValue);
    localStorage.setItem('music_volume', String(sliderValue));
  }

  // Browsers refuse to autoplay audio until the page has had *some* user
  // interaction — a deliberate, unavoidable browser policy, not something
  // any app code can override. But by the time our own login flow gets
  // around to calling audio.play() (after the verify request, the socket
  // connecting, and the first state sync), the click that started it all
  // may no longer count as "recent enough" in some browsers' eyes. Priming
  // playback on the very first pointerdown anywhere — before any of that
  // async chain — gives the browser the earliest, most legitimate gesture
  // to hang its autoplay allowance on, so the "tap to sync" fallback below
  // is only needed on the genuine edge cases, not routinely.
  useEffect(() => {
    function primeOnce() {
      const audio = audioRef.current;
      if (!audio) return;
      const p = audio.play();
      if (p && p.catch) p.catch(() => {}); // just priming — real playback is driven by server state separately
    }
    document.addEventListener('pointerdown', primeOnce, { once: true });
    return () => document.removeEventListener('pointerdown', primeOnce);
  }, []);

  // Socket wiring: kept deliberately dumb — just captures state into React
  // state. The actual audio.src/currentTime/play/pause work happens in the
  // effect below instead of here, on purpose (see its comment).
  useEffect(() => {
    if (!socket) return;
    const audio = audioRef.current;

    function onTracks(t) {
      setTracks(t);
    }
    function onPlaylists(p) {
      setPlaylists(p);
    }
    function onEnded() {
      socket.emit('music:ended', { trackId: lastStateRef.current && lastStateRef.current.trackId });
    }

    socket.on('music:state', setLastState);
    socket.on('music:tracks', onTracks);
    socket.on('music:playlists', onPlaylists);
    audio.addEventListener('ended', onEnded);

    refreshTracks();
    refreshPlaylists();
    socket.emit('music:sync');

    const driftInterval = setInterval(() => {
      const state = lastStateRef.current;
      if (!state || !state.isPlaying || !audio.src) return;
      const target = expectedPosition(state);
      if (Math.abs((audio.currentTime || 0) - target) > 1.2) {
        audio.currentTime = Math.max(0, target);
      }
    }, 8000);

    return () => {
      socket.off('music:state', setLastState);
      socket.off('music:tracks', onTracks);
      socket.off('music:playlists', onPlaylists);
      audio.removeEventListener('ended', onEnded);
      clearInterval(driftInterval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socket]);

  // Applies the current server state to the actual <audio> element.
  // Deliberately a separate effect keyed on BOTH lastState and tracks —
  // not folded into the socket handler above — because the initial
  // music:sync response and the track-list fetch are two independent
  // requests racing each other. If the socket response won that race (very
  // possible on a real network), looking the track up inside a one-shot
  // event handler would find nothing (tracks still []) and silently never
  // set audio.src, with nothing to retry it later — that's what made
  // "nothing plays by default, only switching tracks fixes it" happen.
  // Depending on tracks here means this re-runs the moment the track list
  // actually finishes loading, however that race went.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !lastState) return;
    const track = tracks.find((t) => t.id === lastState.trackId);
    if (!track) {
      audio.pause();
      return;
    }
    if (!audio.src || !audio.src.endsWith(track.url)) {
      audio.src = track.url;
    }
    const target = expectedPosition(lastState);
    if (Math.abs((audio.currentTime || 0) - target) > 1) {
      audio.currentTime = Math.max(0, target);
    }
    if (lastState.isPlaying) {
      const p = audio.play();
      if (p && p.catch) p.catch(() => setNeedsSyncTap(true));
    } else {
      audio.pause();
    }
  }, [lastState, tracks]);

  function retrySync() {
    setNeedsSyncTap(false);
    const p = audioRef.current.play();
    if (p && p.catch) p.catch(() => setNeedsSyncTap(true));
  }

  function togglePlay() {
    if (!lastState) return;
    if (lastState.isPlaying) socket.emit('music:pause');
    else socket.emit('music:play', { position: expectedPosition(lastState) });
  }

  function cycleRepeat() {
    if (!lastState) return;
    const order = ['off', 'track', 'playlist'];
    const cur = order.indexOf(lastState.repeatMode || 'track');
    socket.emit('music:setRepeat', { mode: order[(cur + 1) % order.length] });
  }

  const value = {
    audioRef,
    tracks,
    playlists,
    lastState,
    needsSyncTap,
    retrySync,
    volumeSlider,
    setVolume,
    togglePlay,
    cycleRepeat,
    selectTrack: (trackId) => socket.emit('music:select', { trackId }),
    previous: () => socket.emit('music:previous'),
    next: () => socket.emit('music:next'),
    seek: (position) => socket.emit('music:seek', { position }),
    selectPlaylist: (playlistId) => socket.emit('music:selectPlaylist', { playlistId }),
  };

  return (
    <MusicContext.Provider value={value}>
      <audio ref={audioRef} preload="auto" />
      {needsSyncTap && (
        <button type="button" className="music-sync-prompt" onClick={retrySync}>
          🔊 tap to sync playback
        </button>
      )}
      {children}
    </MusicContext.Provider>
  );
}

export function useMusic() {
  const ctx = useContext(MusicContext);
  if (!ctx) throw new Error('useMusic must be used within a MusicProvider');
  return ctx;
}
