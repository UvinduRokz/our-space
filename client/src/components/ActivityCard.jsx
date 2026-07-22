import './ActivityCard.css';

export default function ActivityCard({ icon, label, onClick, badgeVisible = false }) {
  return (
    <button type="button" className="activity-card" onClick={onClick}>
      <span className="activity-icon">{icon}</span>
      <span className="activity-label">{label}</span>
      {badgeVisible && <span className="activity-badge">💗 here now</span>}
    </button>
  );
}
