export default function TrackList({ tracks, playingId, builderMode, onSelect, onAddToBuilder }) {
  return (
    <ul className="music-track-list">
      {tracks.map((t) => (
        <li
          key={t.id}
          className={`music-track-row${playingId === t.id ? ' playing' : ''}${builderMode ? ' builder-mode' : ''}`}
          onClick={() => (builderMode ? onAddToBuilder(t) : onSelect(t.id))}
        >
          <span className="music-track-title">{t.title}</span>
          <span className="music-track-tag">{t.builtin ? '✨ built-in' : t.side === 'blue' ? '💙' : '💗'}</span>
        </li>
      ))}
    </ul>
  );
}
