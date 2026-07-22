export default function PlaylistSection({
  playlists,
  activePlaylistId,
  onActivate,
  onDelete,
  onNew,
  onEdit,
  builderOpen,
  builderTrackIds,
  tracks,
  nameValue,
  onNameChange,
  onRemoveBuilderTrack,
  onSave,
  onCancel,
  status,
}) {
  return (
    <div className="music-playlists">
      <div className="music-playlists-header">
        <h2>Playlists</h2>
        <button type="button" onClick={onNew}>+ New Playlist</button>
      </div>

      <ul className="music-playlist-list">
        {playlists.map((p) => {
          const isActive = activePlaylistId === p.id;
          return (
            <li key={p.id} className={`music-playlist-row${isActive ? ' active' : ''}`}>
              <span className="music-playlist-name" onClick={() => onActivate(isActive ? null : p.id)}>
                {p.name}
              </span>
              <span className="music-playlist-count" onClick={() => onActivate(isActive ? null : p.id)}>
                {p.trackIds.length} track{p.trackIds.length === 1 ? '' : 's'}
              </span>
              <button type="button" className="music-playlist-edit" title="Edit" onClick={(e) => { e.stopPropagation(); onEdit(p); }}>
                ✎
              </button>
              <button type="button" className="music-playlist-delete" title="Delete" onClick={(e) => { e.stopPropagation(); onDelete(p.id); }}>
                ✕
              </button>
            </li>
          );
        })}
      </ul>

      {builderOpen && (
        <div className="music-playlist-builder">
          <input
            type="text"
            autoComplete="off"
            placeholder="Playlist name"
            maxLength={60}
            value={nameValue}
            onChange={(e) => onNameChange(e.target.value)}
          />
          <p className="hint">Tap tracks below to add them, in order.</p>
          <ul className="music-playlist-builder-tracks">
            {builderTrackIds.map((id, i) => {
              const t = tracks.find((tr) => tr.id === id);
              return (
                <li key={i}>
                  <span>{i + 1}. {t ? t.title : 'unknown track'}</span>
                  <button type="button" onClick={() => onRemoveBuilderTrack(i)}>remove</button>
                </li>
              );
            })}
          </ul>
          <div className="music-playlist-builder-actions">
            <button type="button" onClick={onSave}>Save</button>
            <button type="button" onClick={onCancel}>Cancel</button>
          </div>
          <p className="error">{status}</p>
        </div>
      )}
    </div>
  );
}
