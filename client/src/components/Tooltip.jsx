import { useLayoutEffect, useRef, useState } from 'react';
import './Tooltip.css';

const MARGIN = 8; // gap kept between the bubble and both the trigger and the viewport edge

// Reusable hover/focus tooltip. `position` is a preference, not a guarantee —
// it flips top<->bottom (or left<->right for side tooltips) when there isn't
// enough room, and clamps the cross-axis so the bubble never runs off-screen
// (this matters a lot for the icon buttons pinned near the screen edges).
export default function Tooltip({ text, children, position = 'top' }) {
  const [open, setOpen] = useState(false);
  const [style, setStyle] = useState(null);
  const wrapperRef = useRef(null);
  const bubbleRef = useRef(null);

  useLayoutEffect(() => {
    if (!open) return;

    function reposition() {
      const wrapper = wrapperRef.current;
      const bubble = bubbleRef.current;
      if (!wrapper || !bubble) return;

      const triggerRect = wrapper.getBoundingClientRect();
      const bubbleRect = bubble.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const isSide = position === 'left' || position === 'right';
      const next = {};

      if (isSide) {
        let horiz = position;
        if (horiz === 'left' && triggerRect.left - bubbleRect.width - MARGIN < 0) horiz = 'right';
        else if (horiz === 'right' && triggerRect.right + bubbleRect.width + MARGIN > vw) horiz = 'left';

        let top = triggerRect.top + triggerRect.height / 2 - bubbleRect.height / 2;
        top = Math.max(MARGIN, Math.min(top, vh - bubbleRect.height - MARGIN));
        next.top = top;
        next.left = horiz === 'left' ? triggerRect.left - bubbleRect.width - MARGIN : triggerRect.right + MARGIN;
      } else {
        let vertical = position;
        if (vertical === 'top' && triggerRect.top - bubbleRect.height - MARGIN < 0) vertical = 'bottom';
        else if (vertical === 'bottom' && triggerRect.bottom + bubbleRect.height + MARGIN > vh) vertical = 'top';
        next.top = vertical === 'top' ? triggerRect.top - bubbleRect.height - MARGIN : triggerRect.bottom + MARGIN;

        let left = triggerRect.left + triggerRect.width / 2 - bubbleRect.width / 2;
        left = Math.max(MARGIN, Math.min(left, vw - bubbleRect.width - MARGIN));
        next.left = left;
      }

      setStyle(next);
    }

    reposition();
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    return () => {
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
    };
  }, [open, position, text]);

  if (!text) return children;

  return (
    <span
      className="tooltip-wrapper"
      ref={wrapperRef}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      {children}
      <span
        className="tooltip-bubble"
        role="tooltip"
        ref={bubbleRef}
        style={style ? { top: style.top, left: style.left } : undefined}
      >
        {text}
      </span>
    </span>
  );
}
