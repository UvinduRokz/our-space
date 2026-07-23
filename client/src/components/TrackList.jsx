import Tooltip from './Tooltip.jsx';

export default function TrackList({ tracks, playingId, builderMode, defaultTrackId, onSelect, onAddToBuilder, onToggleDefault }) {
  return (
    <ul className="music-track-list">
      {tracks.map((t) => {
        const isDefault = defaultTrackId === t.id;
        return (
          <li
            key={t.id}
            className={`music-track-row${playingId === t.id ? ' playing' : ''}${builderMode ? ' builder-mode' : ''}`}
            onClick={() => (builderMode ? onAddToBuilder(t) : onSelect(t.id))}
          >
            <span className="music-track-title">{t.title}</span>
            <span className="music-track-tag">{t.builtin ? '✨ built-in' : t.side === 'blue' ? '💙' : '💗'}</span>
            {!builderMode && (
              <Tooltip text={isDefault ? 'Default song — tap to unset' : 'Set as default song'}>
                <button
                  type="button"
                  className={`music-default-star${isDefault ? ' active' : ''}`}
                  onClick={(e) => { e.stopPropagation(); onToggleDefault(t.id); }}
                >
                  {isDefault ? '⭐' : '☆'}
                </button>
              </Tooltip>
            )}
          </li>
        );
      })}
    </ul>
  );
}
