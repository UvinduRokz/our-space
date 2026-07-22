import { useApp } from '../context/AppContext.jsx';
import { useTapFx } from '../context/TapFxContext.jsx';
import IconButton from '../components/IconButton.jsx';
import './MainScreen.css';

function statusText(partnerOnline, partnerNickname) {
  if (partnerOnline === null) return 'connecting…';
  if (partnerOnline) return '';
  return `waiting for ${partnerNickname} to open the page…`;
}

export default function MainScreen() {
  const { navigateTo, partnerOnline, profile } = useApp();
  const { sendTap } = useTapFx();

  // Tap-anywhere-on-this-screen sends a heart tap — matches the old app's
  // click-anywhere behavior, which was global but gated to only act when
  // the current screen was 'main'; putting the handler directly on this
  // screen's own root achieves the same scoping for free, since this
  // component only exists in the DOM while it's the active screen.
  return (
    <section className="screen main-screen" onClick={(e) => sendTap(e.clientX, e.clientY)}>
      <div className="main-left-btns">
        {/* default hitAreaInset (-3px) is already safe for this row's 8px
            gap — see IconButton's doc comment for the math */}
        <IconButton title="Edit profile" size={40} onClick={(e) => { e.stopPropagation(); navigateTo('profile'); }}>
          👤
        </IconButton>
        <IconButton title="Music" size={40} onClick={(e) => { e.stopPropagation(); navigateTo('music'); }}>
          🎵
        </IconButton>
      </div>
      <button type="button" className="activities-btn" onClick={(e) => { e.stopPropagation(); navigateTo('activities'); }}>
        Activities
      </button>

      <div className="heart-wrap">
        <svg id="heart" viewBox="0 0 200 180" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <linearGradient id="heart-gradient" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="var(--blue)" />
              <stop offset="42%" stopColor="var(--blue)" />
              <stop offset="58%" stopColor="var(--pink)" />
              <stop offset="100%" stopColor="var(--pink)" />
            </linearGradient>
            <radialGradient id="gloss-gradient" cx="35%" cy="22%" r="55%">
              <stop offset="0%" stopColor="#ffffff" stopOpacity="0.9" />
              <stop offset="45%" stopColor="#ffffff" stopOpacity="0.25" />
              <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
            </radialGradient>
            <linearGradient id="shade-gradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="55%" stopColor="#000000" stopOpacity="0" />
              <stop offset="100%" stopColor="#000000" stopOpacity="0.4" />
            </linearGradient>
            <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="4" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
            <clipPath id="heart-clip">
              <path d="M100,170 C40,120 10,85 10,55 C10,25 32,5 60,5 C80,5 95,17 100,32 C105,17 120,5 140,5 C168,5 190,25 190,55 C190,85 160,120 100,170 Z" />
            </clipPath>
          </defs>
          <path
            id="heart-path"
            d="M100,170 C40,120 10,85 10,55 C10,25 32,5 60,5 C80,5 95,17 100,32 C105,17 120,5 140,5 C168,5 190,25 190,55 C190,85 160,120 100,170 Z"
            fill="url(#heart-gradient)"
            filter="url(#glow)"
          />
          <g clipPath="url(#heart-clip)">
            <path
              d="M100,170 C40,120 10,85 10,55 C10,25 32,5 60,5 C80,5 95,17 100,32 C105,17 120,5 140,5 C168,5 190,25 190,55 C190,85 160,120 100,170 Z"
              fill="url(#shade-gradient)"
            />
            <path
              d="M100,170 C40,120 10,85 10,55 C10,25 32,5 60,5 C80,5 95,17 100,32 C105,17 120,5 140,5 C168,5 190,25 190,55 C190,85 160,120 100,170 Z"
              fill="url(#gloss-gradient)"
            />
          </g>
        </svg>
      </div>
      <p className="status-line">{statusText(partnerOnline, profile.partnerNickname)}</p>
    </section>
  );
}
