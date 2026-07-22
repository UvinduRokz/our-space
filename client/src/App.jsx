import { AppProvider, useApp } from './context/AppContext.jsx';
import { ToastProvider } from './context/ToastContext.jsx';
import GateScreen from './screens/GateScreen.jsx';
import MainScreen from './screens/MainScreen.jsx';
import ActivitiesScreen from './screens/ActivitiesScreen.jsx';
import ProfileScreen from './screens/ProfileScreen.jsx';
import HistoryScreen from './screens/HistoryScreen.jsx';
import GalleryScreen from './screens/GalleryScreen.jsx';
import BackButton from './components/BackButton.jsx';

// Screens not built yet (later phases) get a placeholder instead of a
// crash if navigated to early. `backTo` matches where each screen's real
// back button points in the old app — Wordle/Hunt/Draw are reached via
// Activities, but Music is reached directly from Main.
function ComingSoon({ label, backTo }) {
  return (
    <section className="screen">
      <BackButton to={backTo} />
      <h1>{label}</h1>
      <p>not built yet — coming in a later phase</p>
    </section>
  );
}

const SCREENS = {
  main: MainScreen,
  activities: ActivitiesScreen,
  profile: ProfileScreen,
  history: HistoryScreen,
  gallery: GalleryScreen,
  'game-wordle': () => <ComingSoon label="Wordle Together" backTo="activities" />,
  'game-hunt': () => <ComingSoon label="Letter Hunt" backTo="activities" />,
  'game-draw': () => <ComingSoon label="Draw Together" backTo="activities" />,
  music: () => <ComingSoon label="Music" backTo="main" />,
};

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
      <ScreenComponent />
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
