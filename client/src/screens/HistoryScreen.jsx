import { useEffect, useState } from 'react';
import { useApp } from '../context/AppContext.jsx';
import BackButton from '../components/BackButton.jsx';
import './HistoryScreen.css';

const RECAP_TILES = [
  { key: 'taps', icon: '💕', label: 'thinking-of-you taps' },
  { key: 'wordleWins', icon: '🔤', label: 'wordles won' },
  { key: 'huntWords', icon: '🔎', label: 'words found' },
  { key: 'drawSessions', icon: '🎨', label: 'drawings together' },
];

const DESCRIBE = {
  tap: () => 'sent a thinking-of-you tap',
  wordle_won: (d) => `won Wordle 🎉 — ${(d.word || '').toUpperCase()} in ${d.guesses} guess${d.guesses === 1 ? '' : 'es'}`,
  wordle_lost: (d) => `lost Wordle 💔 — it was ${(d.word || '').toUpperCase()}`,
  hunt_word: (d) => `found the word "${d.word}" 🔎`,
  hunt_completed: () => 'found all 10 words in Letter Hunt! 🏆',
  draw_cleared: () => 'finished a drawing together 🎨',
};

function formatTime(ts) {
  const d = new Date(ts);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  return sameDay
    ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export default function HistoryScreen() {
  const { apiGet } = useApp();
  const [recap, setRecap] = useState(null);
  const [history, setHistory] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([apiGet('/api/recap'), apiGet('/api/history')])
      .then(([r, h]) => {
        if (cancelled) return;
        setRecap(r);
        setHistory(h);
      })
      .catch((err) => {
        console.warn('[history] failed to load', err);
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sinceText = recap?.firstEventAt
    ? new Date(recap.firstEventAt).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })
    : '—';

  return (
    <section className="screen screen--scrollable">
      <BackButton to="activities" />
      <h1>Our History</h1>

      {recap && (
        <div className="recap-grid">
          {RECAP_TILES.map(({ key, icon, label }) => (
            <div className="recap-tile" key={key}>
              <span className="recap-value">{icon} {recap[key] || 0}</span>
              <span className="recap-label">{label}</span>
            </div>
          ))}
          <div className="recap-tile">
            <span className="recap-value">📅</span>
            <span className="recap-label">together since {sinceText}</span>
          </div>
        </div>
      )}

      <ul className="history-list">
        {failed && <p className="history-empty">couldn't load history right now</p>}
        {!failed && history && history.length === 0 && (
          <p className="history-empty">no memories yet — go make some 💕</p>
        )}
        {!failed &&
          history &&
          [...history].reverse().map((ev, i) => {
            const describe = DESCRIBE[ev.type];
            if (!describe) return null;
            const icon = ev.side === 'blue' ? '💙' : '💗';
            return (
              <li className={`side-${ev.side}`} key={i}>
                <span>{icon} {describe(ev.details || {})}</span>
                <span className="history-time">{formatTime(ev.ts)}</span>
              </li>
            );
          })}
      </ul>
    </section>
  );
}
