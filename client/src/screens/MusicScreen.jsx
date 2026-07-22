import { useEffect, useRef, useState } from 'react';
import { useApp } from '../context/AppContext.jsx';
import { useMusic, expectedPosition } from '../context/MusicContext.jsx';
import BackButton from '../components/BackButton.jsx';
import IconButton from '../components/IconButton.jsx';
import PlaylistSection from '../components/PlaylistSection.jsx';
import TrackList from '../components/TrackList.jsx';
import './MusicScreen.css';

function formatTime(sec) {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export default function MusicScreen() {
  const { name, apiPost } = useApp();
  const {
    audioRef,
    tracks,
    playlists,
    lastState,
    togglePlay,
    previous,
    next,
    cycleRepeat,
    seek,
    selectTrack,
    selectPlaylist,
    volumeSlider,
    setVolume,
  } = useMusic();

  // re-render periodically so the seek bar / elapsed time keep advancing
  // between server updates, matching the old app's 500ms refresh tick —
  // scoped to this screen since it's a pure display concern
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 500);
    return () => clearInterval(id);
  }, []);

  const [isDraggingSeek, setIsDraggingSeek] = useState(false);
  const [seekValue, setSeekValue] = useState(0);

  const [builderOpen, setBuilderOpen] = useState(false);
  const [builderTrackIds, setBuilderTrackIds] = useState([]);
  const [editingPlaylistId, setEditingPlaylistId] = useState(null);
  const [builderName, setBuilderName] = useState('');
  const [builderStatus, setBuilderStatus] = useState('');

  const uploadFileRef = useRef(null);
  const [uploadTitle, setUploadTitle] = useState('');
  const [uploadStatus, setUploadStatus] = useState({ text: '', ok: false });

  const track = lastState ? tracks.find((t) => t.id === lastState.trackId) : null;
  const duration = audioRef.current?.duration || 0;
  const pos = lastState ? expectedPosition(lastState) : 0;
  const seekMax = duration > 0 ? Math.floor(duration) : 100;
  const seekDisplayValue = isDraggingSeek ? seekValue : Math.floor(Math.min(pos, duration || pos));
  const repeatMode = lastState?.repeatMode || 'track';

  function commitSeek() {
    if (!isDraggingSeek) return;
    seek(seekValue);
    setIsDraggingSeek(false);
  }

  function openBuilder(playlist) {
    setEditingPlaylistId(playlist ? playlist.id : null);
    setBuilderTrackIds(playlist ? [...playlist.trackIds] : []);
    setBuilderName(playlist ? playlist.name : '');
    setBuilderStatus('');
    setBuilderOpen(true);
  }

  function closeBuilder() {
    setBuilderOpen(false);
    setEditingPlaylistId(null);
    setBuilderTrackIds([]);
    setBuilderName('');
  }

  function addTrackToBuilder(t) {
    setBuilderTrackIds((ids) => (ids.includes(t.id) ? ids : [...ids, t.id]));
  }

  function removeBuilderTrack(index) {
    setBuilderTrackIds((ids) => ids.filter((_, i) => i !== index));
  }

  function reorderBuilderTrack(fromIndex, toIndex) {
    setBuilderTrackIds((ids) => {
      const next = [...ids];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      return next;
    });
  }

  async function savePlaylist() {
    const trimmedName = builderName.trim();
    if (!trimmedName) {
      setBuilderStatus('name required');
      return;
    }
    if (!builderTrackIds.length) {
      setBuilderStatus('add at least one track');
      return;
    }
    setBuilderStatus('saving…');
    try {
      if (editingPlaylistId) {
        const res = await fetch(`/api/playlists/${editingPlaylistId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', 'x-auth-name': name },
          body: JSON.stringify({ name: trimmedName, trackIds: builderTrackIds }),
        });
        if (!res.ok) throw new Error('save failed');
      } else {
        await apiPost('/api/playlists', { name: trimmedName, trackIds: builderTrackIds });
      }
      // server broadcasts music:playlists to everyone including us, so no
      // manual refetch needed here
      closeBuilder();
    } catch {
      setBuilderStatus("couldn't save playlist");
    }
  }

  async function deletePlaylist(id) {
    await fetch(`/api/playlists/${id}`, { method: 'DELETE', headers: { 'x-auth-name': name } });
  }

  async function reorderPlaylists(fromIndex, toIndex) {
    const next = [...playlists];
    const [moved] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, moved);
    await apiPost('/api/playlists/reorder', { orderedIds: next.map((p) => p.id) });
    // server broadcasts music:playlists back to everyone including us
  }

  async function handleUpload(e) {
    e.preventDefault();
    const file = uploadFileRef.current.files[0];
    if (!file) {
      setUploadStatus({ text: 'choose an mp3 first', ok: false });
      return;
    }
    const formData = new FormData();
    formData.append('file', file);
    if (uploadTitle.trim()) formData.append('title', uploadTitle.trim());

    setUploadStatus({ text: 'uploading…', ok: false });
    try {
      const res = await fetch('/api/music/upload', { method: 'POST', headers: { 'x-auth-name': name }, body: formData });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'upload failed');
      }
      setUploadStatus({ text: 'uploaded! 🎶', ok: true });
      uploadFileRef.current.value = '';
      setUploadTitle('');
      // server broadcasts music:tracks to everyone including us
    } catch (err) {
      setUploadStatus({ text: err.message || "couldn't upload", ok: false });
    }
  }

  return (
    <section className="screen screen--scrollable">
      <BackButton to="main" />
      <h1>Music</h1>

      <div className="music-now-playing">
        <p className="music-now-title">{track ? track.title : 'nothing playing yet'}</p>
        <div className="music-controls">
          <IconButton title="Previous" onClick={previous}>⏮️</IconButton>
          <IconButton title="Play/Pause" size={52} variant="play" hitAreaInset={-6} onClick={togglePlay}>
            {lastState?.isPlaying ? '⏸️' : '▶️'}
          </IconButton>
          <IconButton title="Next" onClick={next}>⏭️</IconButton>
          <IconButton
            title={repeatMode === 'off' ? 'Repeat: off (tap to repeat this track)' : repeatMode === 'track' ? 'Repeat: this track on loop (tap to repeat the playlist instead)' : 'Repeat: whole playlist on loop (tap to turn repeat off)'}
            variant={`repeat-${repeatMode}`}
            onClick={cycleRepeat}
          >
            {repeatMode === 'track' ? '🔂' : '🔁'}
          </IconButton>
        </div>
        <div className="music-seek-row">
          <span>{formatTime(pos)}</span>
          <input
            type="range"
            min="0"
            max={seekMax}
            value={seekDisplayValue}
            onPointerDown={() => setIsDraggingSeek(true)}
            onChange={(e) => setSeekValue(Number(e.target.value))}
            onPointerUp={commitSeek}
          />
          <span>{formatTime(duration)}</span>
        </div>
        <div className="music-volume-row">
          <span>🔈</span>
          <input type="range" min="0" max="100" value={volumeSlider} onChange={(e) => setVolume(Number(e.target.value))} />
        </div>
      </div>

      <PlaylistSection
        playlists={playlists}
        activePlaylistId={lastState?.activePlaylistId ?? null}
        onActivate={selectPlaylist}
        onDelete={deletePlaylist}
        onNew={() => openBuilder(null)}
        onEdit={openBuilder}
        onReorderPlaylists={reorderPlaylists}
        builderOpen={builderOpen}
        builderTrackIds={builderTrackIds}
        onReorderBuilderTrack={reorderBuilderTrack}
        tracks={tracks}
        nameValue={builderName}
        onNameChange={setBuilderName}
        onRemoveBuilderTrack={removeBuilderTrack}
        onSave={savePlaylist}
        onCancel={closeBuilder}
        status={builderStatus}
      />

      <TrackList
        tracks={tracks}
        playingId={lastState?.trackId}
        builderMode={builderOpen}
        onSelect={selectTrack}
        onAddToBuilder={addTrackToBuilder}
      />

      <form className="music-upload-form" onSubmit={handleUpload}>
        <input
          type="text"
          autoComplete="off"
          placeholder="song title (optional)"
          maxLength={60}
          value={uploadTitle}
          onChange={(e) => setUploadTitle(e.target.value)}
        />
        <input ref={uploadFileRef} type="file" accept="audio/mpeg,audio/mp3,.mp3" />
        <button type="submit">Upload MP3</button>
        <p className="error" style={uploadStatus.ok ? { color: '#8fffb0' } : undefined}>{uploadStatus.text}</p>
      </form>
    </section>
  );
}
