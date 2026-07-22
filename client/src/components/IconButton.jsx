import Tooltip from './Tooltip.jsx';
import './IconButton.css';

// The one place border-radius:50% hit-testing gets fixed. Every circular
// button in the app (nav icons, music transport controls, draw toolbar,
// etc.) should render through this instead of hand-rolling its own
// border-radius button — that duplication is exactly what caused the same
// corner-click bug to need fixing twice in the old vanilla app.
//
// hitAreaInset: how far the invisible square click-target extends beyond
// the visible circle, in px (negative = larger target). Default (-3) is
// safe even for the tightest button spacing in the app (8px gaps); pass a
// bigger value (e.g. -6) for buttons with more breathing room around them.
//
// `title` doubles as the tooltip text (via Tooltip) and the aria-label —
// every IconButton gets a consistent hover tooltip for free.
export default function IconButton({
  children,
  onClick,
  title,
  active = false,
  size = 44,
  variant,
  hitAreaInset = -3,
  tooltipPosition = 'top',
  className = '',
  style,
  ...rest
}) {
  return (
    <Tooltip text={title} position={tooltipPosition}>
      <button
        type="button"
        onClick={onClick}
        aria-label={title}
        className={`icon-btn${active ? ' active' : ''}${variant ? ` icon-btn--${variant}` : ''}${className ? ` ${className}` : ''}`}
        style={{
          '--icon-btn-size': `${size}px`,
          '--icon-btn-hit-inset': `${hitAreaInset}px`,
          ...style,
        }}
        {...rest}
      >
        {children}
      </button>
    </Tooltip>
  );
}
