import { AppProvider, useApp } from './context/AppContext.jsx';
import { ToastProvider, useToast } from './context/ToastContext.jsx';
import GateScreen from './screens/GateScreen.jsx';
import IconButton from './components/IconButton.jsx';
import { useState } from 'react';

// Phase 2 vertical slice: proves login, the socket connection, profile
// loading, IconButton, and Toast all work end-to-end. The real MainScreen
// (heart, activities nav, etc.) is built in Phase 3 — this placeholder just
// stands in for "you're logged in" until then.
function LoggedInPlaceholder() {
  const { name, side, profile, partnerOnline, partnerActivity, socket } = useApp();
  const showToast = useToast();
  const [repeatActive, setRepeatActive] = useState(false);

  return (
    <section className="screen">
      <h1>logged in ✅</h1>
      <p>name: {name} · side: {side}</p>
      <p>partner nickname: {profile.partnerNickname} · bear: {profile.bear}</p>
      <p>socket connected: {socket ? 'yes' : 'connecting…'}</p>
      <p>partner online: {partnerOnline ? 'yes' : 'no'} · partner activity: {partnerActivity}</p>

      <div style={{ display: 'flex', gap: 14, marginTop: 20 }}>
        <IconButton title="Previous">⏮️</IconButton>
        <IconButton title="Play" variant="play" size={52}>▶️</IconButton>
        <IconButton title="Next">⏭️</IconButton>
        <IconButton
          title="Repeat"
          active={repeatActive}
          onClick={() => setRepeatActive((a) => !a)}
        >
          🔂
        </IconButton>
      </div>

      <button
        type="button"
        style={{ marginTop: 20 }}
        onClick={() => showToast('💌 test toast from Phase 2')}
      >
        show test toast
      </button>
    </section>
  );
}

function Shell() {
  const { authStatus } = useApp();

  return (
    <>
      <div id="bg-split" />
      {authStatus === 'checking' && (
        <section className="screen">
          <p>checking session…</p>
        </section>
      )}
      {authStatus === 'unauthenticated' && <GateScreen />}
      {authStatus === 'authenticated' && <LoggedInPlaceholder />}
    </>
  );
}

export default function App() {
  return (
    <AppProvider>
      <ToastProvider>
        <Shell />
      </ToastProvider>
    </AppProvider>
  );
}
