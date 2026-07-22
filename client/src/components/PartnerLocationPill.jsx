import { useApp } from '../context/AppContext.jsx';
import './PartnerLocationPill.css';

// Maps the activity keys AppContext already tracks to a human-readable
// label — kept local since it's purely a display concern of this one
// component, not something other consumers of AppContext need.
const ACTIVITY_LABELS = {
  idle: 'the main screen',
  activities: 'Activities',
  wordle: 'Wordle Together',
  hunt: 'Letter Hunt',
  draw: 'Draw Together',
  profile: 'their Profile',
  history: 'Our History',
  gallery: 'the Gallery',
  music: 'Music',
};

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

// Persistent, always-visible (while the partner is online) indicator of
// where they currently are in the app — not just the Activities screen's
// per-card badges, which only cover the three co-op games.
export default function PartnerLocationPill() {
  const { currentScreen, partnerActivity, partnerOnline, profile } = useApp();

  if (!partnerOnline || currentScreen === 'gate') return null;

  const myActivity = SCREEN_TO_ACTIVITY[currentScreen];
  const togetherHere = !!myActivity && myActivity === partnerActivity;

  return (
    <div className={`partner-location-pill${togetherHere ? ' together' : ''}`}>
      {togetherHere
        ? "💕 you're both here"
        : `💗 ${profile.partnerNickname || 'they'} is on ${ACTIVITY_LABELS[partnerActivity] || 'somewhere in the app'}`}
    </div>
  );
}
