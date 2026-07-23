import { useState } from 'react';
import Tooltip from './Tooltip.jsx';
import './PlaylistSection.css';

// Minimal native HTML5 drag-and-drop for reordering a list. The dragged
// index travels through the native dataTransfer object (available
// synchronously for the whole gesture) rather than React state — state
// updates from onDragStart aren't guaranteed to have re-rendered by the
// time onDrop fires moments later, so reading an index back out of a
// closure captured before that re-render would intermittently read stale
// data. dragIndex (state) is kept only for the .dragging visual class,
// which doesn't need to be synchronous.
const DND_MIME = 'application/x-reorder-index';

function useDragReorder(onReorder) {
  const [dragIndex, setDragIndex] = useState(null);

  function dragHandlers(index) {
    return {
      draggable: true,
      onDragStart: (e) => {
        e.dataTransfer.setData(DND_MIME, String(index));
        e.dataTransfer.effectAllowed = 'move';
        setDragIndex(index);
      },
      onDragOver: (e) => e.preventDefault(),
      onDrop: (e) => {
        e.preventDefault();
        const fromIndex = Number(e.dataTransfer.getData(DND_MIME));
        if (Number.isNaN(fromIndex) || fromIndex === index) return;
        onReorder(fromIndex, index);
        setDragIndex(null);
      },
      onDragEnd: () => setDragIndex(null),
    };
  }

  return { dragHandlers, dragIndex };
}

export default function PlaylistSection({
  playlists,
  activePlaylistId,
  onActivate,
  onDelete,
  onNew,
  onEdit,
  onReorderPlaylists,
  builderOpen,
  builderTrackIds,
  onReorderBuilderTrack,
  tracks,
  nameValue,
  onNameChange,
  onRemoveBuilderTrack,
  onSave,
  onCancel,
  status,
  defaultPlaylistId,
  onToggleDefault,
}) {
  const playlistDrag = useDragReorder(onReorderPlaylists);
  const trackDrag = useDragReorder(onReorderBuilderTrack);

  return (
    <div className="music-playlists">
      <div className="music-playlists-header">
        <h2>Playlists</h2>
        <button type="button" onClick={onNew}>+ New Playlist</button>
      </div>

      <ul className="music-playlist-list">
        {playlists.map((p, i) => {
          const isActive = activePlaylistId === p.id;
          return (
            <li
              key={p.id}
              className={`music-playlist-row${isActive ? ' active' : ''}${playlistDrag.dragIndex === i ? ' dragging' : ''}`}
              {...playlistDrag.dragHandlers(i)}
            >
              <Tooltip text="Drag to reorder">
                <span className="music-drag-handle">⠿</span>
              </Tooltip>
              <span className="music-playlist-name" onClick={() => onActivate(isActive ? null : p.id)}>
                {p.name}
              </span>
              <span className="music-playlist-count" onClick={() => onActivate(isActive ? null : p.id)}>
                {p.trackIds.length} track{p.trackIds.length === 1 ? '' : 's'}
              </span>
              <Tooltip text={defaultPlaylistId === p.id ? 'Default playlist — tap to unset' : 'Set as default playlist'}>
                <button
                  type="button"
                  className={`music-default-star${defaultPlaylistId === p.id ? ' active' : ''}`}
                  onClick={(e) => { e.stopPropagation(); onToggleDefault(p.id); }}
                >
                  {defaultPlaylistId === p.id ? '⭐' : '☆'}
                </button>
              </Tooltip>
              <Tooltip text="Edit playlist">
                <button type="button" className="music-playlist-edit" onClick={(e) => { e.stopPropagation(); onEdit(p); }}>
                  ✎
                </button>
              </Tooltip>
              <Tooltip text="Delete playlist">
                <button type="button" className="music-playlist-delete" onClick={(e) => { e.stopPropagation(); onDelete(p.id); }}>
                  ✕
                </button>
              </Tooltip>
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
          <p className="hint">Tap tracks below to add them, or drag to reorder.</p>
          <ul className="music-playlist-builder-tracks">
            {builderTrackIds.map((id, i) => {
              const t = tracks.find((tr) => tr.id === id);
              return (
                <li key={id} className={trackDrag.dragIndex === i ? 'dragging' : ''} {...trackDrag.dragHandlers(i)}>
                  <span className="music-drag-handle">⠿</span>
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
