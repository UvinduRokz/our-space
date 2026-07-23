import { useApp } from '../context/AppContext.jsx';
import BackButton from '../components/BackButton.jsx';
import ActivityCard from '../components/ActivityCard.jsx';
import './ActivitiesScreen.css';

const CARDS = [
  { activity: 'wordle', screen: 'game-wordle', icon: '🔤', label: 'Wordle Together', showBadge: true },
  { activity: 'hunt', screen: 'game-hunt', icon: '🔎', label: 'Letter Hunt', showBadge: true },
  { activity: 'draw', screen: 'game-draw', icon: '🎨', label: 'Draw Together', showBadge: true },
  { activity: 'history', screen: 'history', icon: '📖', label: 'Our History', showBadge: false },
  { activity: 'gallery', screen: 'gallery', icon: '🖼️', label: 'Gallery', showBadge: false },
];

export default function ActivitiesScreen() {
  const { navigateTo, partnerActivity, side, profiles } = useApp();
  const partnerSide = side === 'blue' ? 'pink' : 'blue';
  const partnerBear = profiles[partnerSide].bear;

  return (
    <section className="screen screen--scrollable">
      <BackButton to="main" />
      <h1>Activities</h1>
      <div className="activity-cards">
        {CARDS.map((c) => (
          <ActivityCard
            key={c.activity}
            icon={c.icon}
            label={c.label}
            onClick={() => navigateTo(c.screen)}
            badgeVisible={c.showBadge && partnerActivity === c.activity}
            partnerBear={partnerBear}
          />
        ))}
      </div>
    </section>
  );
}
