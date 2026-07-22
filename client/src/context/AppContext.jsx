import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { io } from 'socket.io-client';

const AppContext = createContext(null);

const DEFAULT_PROFILE = { partnerNickname: 'babe', bear: 'tenderheart-bear' };

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
// re-verified on boot; once authenticated, connect the socket and load the
// profile. Push notification setup is deferred to a later phase.
export function AppProvider({ children }) {
  const [name, setName] = useState(() => localStorage.getItem('toy_name') || '');
  const [side, setSide] = useState(() => localStorage.getItem('toy_side') || '');
  const [authStatus, setAuthStatus] = useState('checking'); // 'checking' | 'authenticated' | 'unauthenticated'
  const [profile, setProfile] = useState(DEFAULT_PROFILE);
  const [partnerActivity, setPartnerActivity] = useState('idle');
  const [partnerOnline, setPartnerOnline] = useState(false);
  const [socket, setSocket] = useState(null);

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

    return () => {
      nextSocket.disconnect();
      setSocket(null);
    };
  }, [authStatus, name, side]);

  const value = {
    name,
    side,
    authStatus,
    profile,
    setProfile,
    partnerActivity,
    partnerOnline,
    socket,
    login,
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
