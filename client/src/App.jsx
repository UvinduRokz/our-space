import { useEffect } from 'react';
import { AppProvider, useApp } from './context/AppContext.jsx';
import { ToastProvider, useToast } from './context/ToastContext.jsx';
import { MusicProvider } from './context/MusicContext.jsx';
import { TapFxProvider } from './context/TapFxContext.jsx';
import { playSfx } from './lib/sfx.js';
import PartnerLocationPill from './components/PartnerLocationPill.jsx';
import GateScreen from './screens/GateScreen.jsx';
import MainScreen from './screens/MainScreen.jsx';
import ActivitiesScreen from './screens/ActivitiesScreen.jsx';
import ProfileScreen from './screens/ProfileScreen.jsx';
import HistoryScreen from './screens/HistoryScreen.jsx';
import GalleryScreen from './screens/GalleryScreen.jsx';
import WordleScreen from './screens/WordleScreen.jsx';
import HuntScreen from './screens/HuntScreen.jsx';
import DrawScreen from './screens/DrawScreen.jsx';
import MusicScreen from './screens/MusicScreen.jsx';

const SCREENS = {
  main: MainScreen,
  activities: ActivitiesScreen,
  profile: ProfileScreen,
  history: HistoryScreen,
  gallery: GalleryScreen,
  'game-wordle': WordleScreen,
  'game-hunt': HuntScreen,
  'game-draw': DrawScreen,
  music: MusicScreen,
};

// AppContext and ToastContext are siblings in the provider tree (neither
// can see the other), but "partner opened the Activities menu" needs both
// the socket and the toast — this tiny non-visual component sits inside
// both, purely to bridge that one event.
function GlobalSocketEvents() {
  const { socket, profile } = useApp();
  const showToast = useToast();

  useEffect(() => {
    if (!socket) return;
    function onPing() {
      showToast(`💌 ${profile.partnerNickname} wants to play together!`);
      playSfx('ping');
    }
    socket.on('activity:ping', onPing);
    return () => socket.off('activity:ping', onPing);
  }, [socket, showToast, profile.partnerNickname]);

  return null;
}

function Shell() {
  const { authStatus, currentScreen } = useApp();

  if (authStatus === 'checking') {
    return (
      <>
        <div id="bg-split" />
        <section className="screen">
          <p>checking session…</p>
        </section>
      </>
    );
  }

  if (authStatus === 'unauthenticated') {
    return (
      <>
        <div id="bg-split" />
        <GateScreen />
      </>
    );
  }

  const ScreenComponent = SCREENS[currentScreen] || MainScreen;
  return (
    <>
      <div id="bg-split" />
      <GlobalSocketEvents />
      <PartnerLocationPill />
      <ScreenComponent />
    </>
  );
}

export default function App() {
  return (
    <AppProvider>
      <MusicProvider>
        <TapFxProvider>
          <ToastProvider>
            <Shell />
          </ToastProvider>
        </TapFxProvider>
      </MusicProvider>
    </AppProvider>
  );
}
