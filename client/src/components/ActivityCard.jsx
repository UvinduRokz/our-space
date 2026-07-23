import './ActivityCard.css';

export default function ActivityCard({ icon, label, onClick, badgeVisible = false, partnerBear }) {
  return (
    <button type="button" className="activity-card" onClick={onClick}>
      <span className="activity-icon">{icon}</span>
      <span className="activity-label">{label}</span>
      {badgeVisible && (
        <span className="activity-badge">
          <img src={`/cursors/${partnerBear}-idle.svg`} alt="" className="activity-badge-bear" />
          here now
        </span>
      )}
    </button>
  );
}
