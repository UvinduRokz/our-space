import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { io } from 'socket.io-client';
import { setupPush } from '../lib/push.js';

const AppContext = createContext(null);

const DEFAULT_PROFILE = { partnerNickname: 'babe', bear: 'tenderheart-bear' };

// Maps a screen id to the activity key broadcast to your partner (and used
// to decide whether the partner-location pill should say "you're both
// here"). Screens not listed here don't exist yet (added as later phases
// port them) — navigateTo() just skips the broadcast for those.
const SCREEN_TO_ACTIVITY = {
  main: 'idle',
  activities: 'activities',
  'game-wordle': 'wordle',
  'game-hunt': 'hunt',
  'game-draw': 'draw',
  profile: 'profile',
  history: 'history',
  gallery: 'gallery',
  music: 'music',
};

async function apiPost(path, body, name) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-auth-name': name || '' },
    body: JSON.stringify(body || {}),
  });
  if (!res.ok) throw new Error('request failed: ' + res.status);
  return res.json();
}

async function apiGet(path, name) {
  const res = await fetch(path, { headers: { 'x-auth-name': name || '' } });
  if (!res.ok) throw new Error('request failed: ' + res.status);
  return res.json();
}

// Mirrors the old public/app.js flow: persisted name/side in localStorage,
// re-verified on boot; once authenticated, connect the socket, load the
// profile, and set up push notifications.
export function AppProvider({ children }) {
  const [name, setName] = useState(() => localStorage.getItem('toy_name') || '');
  const [side, setSide] = useState(() => localStorage.getItem('toy_side') || '');
  const [authStatus, setAuthStatus] = useState('checking'); // 'checking' | 'authenticated' | 'unauthenticated'
  const [profile, setProfile] = useState(DEFAULT_PROFILE);
  // Both sides' own profiles — /api/profile only ever returns YOUR OWN, so
  // this is what lets a screen show your PARTNER's chosen bear (their
  // visual identity) rather than just your own cursor.
  const [profiles, setProfiles] = useState({ blue: DEFAULT_PROFILE, pink: DEFAULT_PROFILE });
  const [partnerActivity, setPartnerActivity] = useState('idle');
  const [partnerOnline, setPartnerOnline] = useState(null); // null = no presence event received yet
  const [socket, setSocket] = useState(null);
  const [currentScreen, setCurrentScreen] = useState('main');
  const [vapidPublicKey, setVapidPublicKey] = useState(null);

  useEffect(() => {
    fetch('/api/config')
      .then((res) => res.json())
      .then((cfg) => setVapidPublicKey(cfg.vapidPublicKey || null))
      .catch((err) => console.warn('[config] failed to load /api/config', err));
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!name || !side) {
        setAuthStatus('unauthenticated');
        return;
      }
      try {
        await apiPost('/api/verify', { name }, name);
        if (!cancelled) setAuthStatus('authenticated');
      } catch {
        if (!cancelled) {
          localStorage.removeItem('toy_name');
          localStorage.removeItem('toy_side');
          setName('');
          setSide('');
          setAuthStatus('unauthenticated');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // only re-check on mount — login() handles the interactive path
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const login = useCallback(async (inputName) => {
    const result = await apiPost('/api/verify', { name: inputName }, inputName);
    localStorage.setItem('toy_name', inputName);
    localStorage.setItem('toy_side', result.side);
    setName(inputName);
    setSide(result.side);
    setAuthStatus('authenticated');
  }, []);

  useEffect(() => {
    if (authStatus !== 'authenticated') return;

    apiGet('/api/profile', name)
      .then(setProfile)
      .catch((err) => console.warn('[profile] failed to load, using defaults', err));
    apiGet('/api/profiles', name)
      .then(setProfiles)
      .catch((err) => console.warn('[profiles] failed to load, using defaults', err));

    const nextSocket = io({ auth: { name } });
    setSocket(nextSocket);

    const otherSide = side === 'blue' ? 'pink' : 'blue';
    nextSocket.on('presence', ({ online }) => {
      setPartnerOnline(online.includes(otherSide));
    });
    nextSocket.on('activity:state', ({ side: fromSide, activity }) => {
      if (fromSide !== otherSide) return;
      setPartnerActivity(activity);
    });
    nextSocket.on('profile:updated', ({ side: fromSide, ...updated }) => {
      setProfiles((prev) => ({ ...prev, [fromSide]: updated }));
    });

    return () => {
      nextSocket.disconnect();
      setSocket(null);
    };
  }, [authStatus, name, side]);

  useEffect(() => {
    if (authStatus !== 'authenticated' || !vapidPublicKey) return;
    setupPush(vapidPublicKey, (path, body) => apiPost(path, body, name));
  }, [authStatus, vapidPublicKey, name]);

  // The custom bear cursor: driven by CSS custom properties on the root
  // element so any screen can just `cursor: var(--cursor-idle)` without
  // needing to know which bear is selected.
  useEffect(() => {
    const bear = profile.bear || 'tenderheart-bear';
    document.documentElement.style.setProperty('--cursor-idle', `url('/cursors/${bear}-idle.svg') 8 9, auto`);
    document.documentElement.style.setProperty('--cursor-wave', `url('/cursors/${bear}-hover.svg') 8 9, auto`);
  }, [profile.bear]);

  const navigateTo = useCallback(
    (screenId) => {
      setCurrentScreen(screenId);
      if (socket && SCREEN_TO_ACTIVITY[screenId]) {
        socket.emit('activity:update', { activity: SCREEN_TO_ACTIVITY[screenId] });
      }
    },
    [socket]
  );

  const value = {
    name,
    side,
    authStatus,
    profile,
    setProfile,
    profiles,
    partnerActivity,
    partnerOnline,
    socket,
    login,
    currentScreen,
    navigateTo,
    apiGet: (path) => apiGet(path, name),
    apiPost: (path, body) => apiPost(path, body, name),
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within an AppProvider');
  return ctx;
}
