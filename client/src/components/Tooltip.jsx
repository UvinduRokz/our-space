import './Tooltip.css';

// Reusable hover/focus tooltip — CSS-driven (no JS positioning), so it's
// cheap to wrap anything with. `position` picks which side of the child
// the bubble opens toward; default 'top' suits most icon buttons.
export default function Tooltip({ text, children, position = 'top' }) {
  if (!text) return children;
  return (
    <span className={`tooltip-wrapper tooltip-${position}`}>
      {children}
      <span className="tooltip-bubble" role="tooltip">
        {text}
      </span>
    </span>
  );
}
