(function () {
  const $ = (id) => document.getElementById(id);

  let audio, syncPrompt;
  let tracks = [];
  let playlists = [];
  let lastState = null; // last known {trackId, isPlaying, position, repeatMode, activePlaylistId, serverNow} from the server
  let isDraggingSeek = false;
  let builderOpen = false;
  let builderTrackIds = [];
  let editingPlaylistId = null;

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function formatTime(sec) {
    if (!Number.isFinite(sec) || sec < 0) sec = 0;
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  function trackById(id) {
    return tracks.find((t) => t.id === id);
  }

  // Human hearing perceives loudness roughly logarithmically, but the slider
  // position is linear — a straight pass-through to audio.volume means most
  // of the audible drop only happens in the last few pixels near the very
  // left edge, so the slider feels "stuck loud" everywhere else. Squaring
  // the fraction tapers it so perceived loudness tracks slider position.
  function sliderToVolume(sliderValue) {
    const fraction = Math.min(1, Math.max(0, Number(sliderValue) / 100));
    return fraction * fraction;
  }

  async function refreshTracks() {
    try {
      tracks = await window.App.apiGet('/api/music');
    } catch (err) {
      console.warn('[music] failed to load track list', err);
    }
    return tracks;
  }

  async function refreshPlaylists() {
    try {
      playlists = await window.App.apiGet('/api/playlists');
    } catch (err) {
      console.warn('[music] failed to load playlists', err);
    }
    return playlists;
  }

  // Position the server told us about, projected forward by however long
  // it's been since that message arrived (server is authoritative; this is
  // just a local estimate between updates).
  function expectedPosition(state) {
    if (!state.isPlaying) return state.position;
    return state.position + (Date.now() - state.serverNow) / 1000;
  }

  function renderTrackListHighlight(trackId) {
    document.querySelectorAll('.music-track-row').forEach((row) => {
      row.classList.toggle('playing', row.dataset.trackId === trackId);
    });
  }

  function renderTrackList() {
    const listEl = $('music-track-list');
    if (!listEl) return;
    listEl.innerHTML = '';
    tracks.forEach((t) => {
      const li = document.createElement('li');
      li.className = 'music-track-row';
      li.dataset.trackId = t.id;
      const tag = t.builtin ? '✨ built-in' : t.side === 'blue' ? '💙' : '💗';
      li.innerHTML = `<span class="music-track-title">${escapeHtml(t.title)}</span><span class="music-track-tag">${tag}</span>`;
      li.classList.toggle('builder-mode', builderOpen);
      li.addEventListener('click', () => {
        if (builderOpen) addTrackToBuilder(t);
        else window.App.socket.emit('music:select', { trackId: t.id });
      });
      listEl.appendChild(li);
    });
    renderTrackListHighlight(lastState ? lastState.trackId : null);
  }

  function renderPlaylistList() {
    const listEl = $('music-playlist-list');
    if (!listEl) return;
    listEl.innerHTML = '';
    playlists.forEach((p) => {
      const li = document.createElement('li');
      li.className = 'music-playlist-row';
      const isActive = lastState && lastState.activePlaylistId === p.id;
      li.classList.toggle('active', isActive);
      const count = p.trackIds.length;
      li.innerHTML = `<span class="music-playlist-name">${escapeHtml(p.name)}</span><span class="music-playlist-count">${count} track${count === 1 ? '' : 's'}</span><button type="button" class="music-playlist-edit" title="Edit">✎</button><button type="button" class="music-playlist-delete" title="Delete">✕</button>`;
      li.querySelector('.music-playlist-name').addEventListener('click', () => {
        window.App.socket.emit('music:selectPlaylist', { playlistId: isActive ? null : p.id });
      });
      li.querySelector('.music-playlist-count').addEventListener('click', () => {
        window.App.socket.emit('music:selectPlaylist', { playlistId: isActive ? null : p.id });
      });
      li.querySelector('.music-playlist-edit').addEventListener('click', (e) => {
        e.stopPropagation();
        openBuilder(p);
      });
      li.querySelector('.music-playlist-delete').addEventListener('click', async (e) => {
        e.stopPropagation();
        await fetch(`/api/playlists/${p.id}`, { method: 'DELETE', headers: { 'x-auth-name': window.App.name } });
        await refreshPlaylists();
        renderPlaylistList();
      });
      listEl.appendChild(li);
    });
  }

  function renderBuilderTracks() {
    const listEl = $('music-playlist-builder-tracks');
    if (!listEl) return;
    listEl.innerHTML = '';
    builderTrackIds.forEach((id, i) => {
      const t = trackById(id);
      const li = document.createElement('li');
      li.innerHTML = `<span>${i + 1}. ${escapeHtml(t ? t.title : 'unknown track')}</span><button type="button">remove</button>`;
      li.querySelector('button').addEventListener('click', () => {
        builderTrackIds.splice(i, 1);
        renderBuilderTracks();
      });
      listEl.appendChild(li);
    });
  }

  function addTrackToBuilder(t) {
    if (!builderTrackIds.includes(t.id)) builderTrackIds.push(t.id);
    renderBuilderTracks();
  }

  function openBuilder(playlist) {
    editingPlaylistId = playlist ? playlist.id : null;
    builderTrackIds = playlist ? [...playlist.trackIds] : [];
    $('music-playlist-name-input').value = playlist ? playlist.name : '';
    const statusEl = $('music-playlist-status');
    statusEl.textContent = '';
    builderOpen = true;
    $('music-playlist-builder').classList.remove('hidden');
    renderBuilderTracks();
    renderTrackList();
  }

  function closeBuilder() {
    builderOpen = false;
    editingPlaylistId = null;
    builderTrackIds = [];
    $('music-playlist-builder').classList.add('hidden');
    $('music-playlist-name-input').value = '';
    renderTrackList();
  }

  function renderNowPlaying() {
    const titleEl = $('music-now-title');
    if (!titleEl || !lastState) return;
    const track = trackById(lastState.trackId);
    const playBtn = $('music-play-btn');
    const seekSlider = $('music-seek-slider');
    const curTimeEl = $('music-time-current');
    const totalTimeEl = $('music-time-total');

    titleEl.textContent = track ? track.title : 'nothing playing yet';
    playBtn.textContent = lastState.isPlaying ? '⏸️' : '▶️';

    const duration = audio.duration || 0;
    const pos = expectedPosition(lastState);
    curTimeEl.textContent = formatTime(pos);
    totalTimeEl.textContent = formatTime(duration);
    if (duration > 0) seekSlider.max = Math.floor(duration);
    if (!isDraggingSeek) seekSlider.value = Math.floor(Math.min(pos, duration || pos));

    renderTrackListHighlight(lastState.trackId);
    renderRepeatButton();
    renderPlaylistList();
  }

  function renderRepeatButton() {
    const btn = $('music-repeat-btn');
    if (!btn || !lastState) return;
    const mode = lastState.repeatMode || 'track';
    btn.textContent = mode === 'track' ? '🔂' : '🔁';
    btn.classList.toggle('active', mode !== 'off');
    btn.title = mode === 'off' ? 'Repeat: off' : mode === 'track' ? 'Repeat: this track' : 'Repeat: whole playlist';
  }

  function applyState(state) {
    lastState = state;
    const track = trackById(state.trackId);

    if (!track) {
      audio.pause();
      renderNowPlaying();
      return;
    }

    if (!audio.src || !audio.src.endsWith(track.url)) {
      audio.src = track.url;
    }

    const target = expectedPosition(state);
    if (Math.abs((audio.currentTime || 0) - target) > 1) {
      audio.currentTime = Math.max(0, target);
    }

    if (state.isPlaying) {
      const p = audio.play();
      if (p && p.catch) p.catch(() => syncPrompt.classList.remove('hidden'));
    } else {
      audio.pause();
    }

    renderNowPlaying();
  }

  function startDriftCheck() {
    setInterval(() => {
      if (!lastState || !lastState.isPlaying || !audio.src) return;
      const target = expectedPosition(lastState);
      if (Math.abs((audio.currentTime || 0) - target) > 1.2) {
        audio.currentTime = Math.max(0, target);
      }
    }, 8000);
  }

  let screenWired = false;
  function wireScreenOnce() {
    console.log('[music] wireScreenOnce() called, already wired =', screenWired);
    if (screenWired) return;
    screenWired = true;

    const volumeSlider = $('music-volume-slider');
    console.log('[music][volume] wireScreenOnce: volumeSlider element =', volumeSlider, ' audio element =', audio);
    const savedVolume = localStorage.getItem('music_volume');
    volumeSlider.value = savedVolume !== null ? savedVolume : 70;
    console.log('[music][volume] initial slider.value set to', volumeSlider.value, '(savedVolume in localStorage was', savedVolume, ')');

    function applyVolumeFromSlider(eventName) {
      const vol = sliderToVolume(volumeSlider.value);
      console.log(`[music][volume] '${eventName}' fired — slider.value=${volumeSlider.value}, computed vol=${vol}, audio element present=${!!audio}`);
      if (!audio) {
        console.error('[music][volume] audio element is missing — MusicPlayer.init() may not have run yet. Volume cannot be applied.');
        return;
      }
      audio.volume = vol;
      audio.muted = vol === 0; // iOS Safari ignores .volume entirely; .muted is the only thing it respects
      localStorage.setItem('music_volume', volumeSlider.value);
      console.log(`[music][volume] after assignment — audio.volume=${audio.volume}, audio.muted=${audio.muted}`);
    }

    volumeSlider.addEventListener('input', () => applyVolumeFromSlider('input'));
    // some touch/mobile webviews are inconsistent about firing 'input' for
    // range sliders — 'change' as a backup covers that, and doubles as a
    // diagnostic to tell input-not-firing apart from something else broken
    volumeSlider.addEventListener('change', () => applyVolumeFromSlider('change'));

    $('music-play-btn').addEventListener('click', () => {
      if (!lastState) return;
      if (lastState.isPlaying) window.App.socket.emit('music:pause');
      else window.App.socket.emit('music:play', { position: expectedPosition(lastState) });
    });
    $('music-prev-btn').addEventListener('click', () => window.App.socket.emit('music:previous'));
    $('music-next-btn').addEventListener('click', () => window.App.socket.emit('music:next'));
    $('music-repeat-btn').addEventListener('click', () => {
      if (!lastState) return;
      const order = ['off', 'track', 'playlist'];
      const cur = order.indexOf(lastState.repeatMode || 'track');
      window.App.socket.emit('music:setRepeat', { mode: order[(cur + 1) % order.length] });
    });

    $('music-playlist-new-btn').addEventListener('click', () => openBuilder(null));
    $('music-playlist-cancel-btn').addEventListener('click', () => closeBuilder());
    $('music-playlist-save-btn').addEventListener('click', async () => {
      const name = $('music-playlist-name-input').value.trim();
      const statusEl = $('music-playlist-status');
      if (!name) { statusEl.style.color = '#ff8080'; statusEl.textContent = 'name required'; return; }
      if (!builderTrackIds.length) { statusEl.style.color = '#ff8080'; statusEl.textContent = 'add at least one track'; return; }
      statusEl.style.color = '';
      statusEl.textContent = 'saving…';
      try {
        if (editingPlaylistId) {
          const res = await fetch(`/api/playlists/${editingPlaylistId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', 'x-auth-name': window.App.name },
            body: JSON.stringify({ name, trackIds: builderTrackIds }),
          });
          if (!res.ok) throw new Error('save failed');
        } else {
          await window.App.apiPost('/api/playlists', { name, trackIds: builderTrackIds });
        }
        await refreshPlaylists();
        renderPlaylistList();
        closeBuilder();
      } catch (err) {
        statusEl.style.color = '#ff8080';
        statusEl.textContent = "couldn't save playlist";
      }
    });

    const seekSlider = $('music-seek-slider');
    seekSlider.addEventListener('pointerdown', () => { isDraggingSeek = true; });
    seekSlider.addEventListener('change', () => {
      window.App.socket.emit('music:seek', { position: Number(seekSlider.value) });
      isDraggingSeek = false;
    });

    $('music-upload-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fileInput = $('music-upload-file');
      const titleInput = $('music-upload-title');
      const statusEl = $('music-upload-status');
      const file = fileInput.files[0];
      if (!file) { statusEl.textContent = 'choose an mp3 first'; return; }

      const formData = new FormData();
      formData.append('file', file);
      if (titleInput.value.trim()) formData.append('title', titleInput.value.trim());

      statusEl.style.color = '';
      statusEl.textContent = 'uploading…';
      try {
        const res = await fetch('/api/music/upload', {
          method: 'POST',
          headers: { 'x-auth-name': window.App.name },
          body: formData,
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || 'upload failed');
        }
        statusEl.style.color = '#8fffb0';
        statusEl.textContent = 'uploaded! 🎶';
        fileInput.value = '';
        titleInput.value = '';
        await refreshTracks();
        renderTrackList();
      } catch (err) {
        statusEl.style.color = '#ff8080';
        statusEl.textContent = err.message || "couldn't upload";
      }
    });
  }

  window.registerGame('music', {
    enter() {
      wireScreenOnce();
      refreshTracks().then(() => {
        renderTrackList();
        renderNowPlaying();
      });
      refreshPlaylists().then(() => renderPlaylistList());
    },
  });

  window.MusicPlayer = {
    init() {
      audio = $('music-audio');
      syncPrompt = $('music-sync-prompt');
      console.log('[music][init] MusicPlayer.init() running — audio element =', audio);

      const savedVolume = localStorage.getItem('music_volume');
      const initialVol = sliderToVolume(savedVolume !== null ? savedVolume : 70);
      audio.volume = initialVol;
      audio.muted = initialVol === 0;
      console.log(`[music][init] initial volume applied — savedVolume=${savedVolume}, computed vol=${initialVol}, audio.volume now=${audio.volume}, audio.muted=${audio.muted}`);

      syncPrompt.addEventListener('click', () => {
        syncPrompt.classList.add('hidden');
        const p = audio.play();
        if (p && p.catch) p.catch(() => syncPrompt.classList.remove('hidden'));
      });

      // Report to the server when playback naturally finishes; the server is
      // authoritative for what happens next (restart/advance/stop) based on
      // repeatMode, same as every other music:* action.
      audio.addEventListener('ended', () => {
        window.App.socket.emit('music:ended', { trackId: lastState && lastState.trackId });
      });

      window.App.socket.on('music:state', applyState);
      window.App.socket.on('music:tracks', (t) => { tracks = t; renderTrackList(); });
      window.App.socket.on('music:playlists', (p) => { playlists = p; renderPlaylistList(); });
      refreshTracks().then(() => {
        if (lastState) renderNowPlaying();
      });
      refreshPlaylists();
      window.App.socket.emit('music:sync');
      startDriftCheck();
      setInterval(() => { if (lastState) renderNowPlaying(); }, 500);
    },
  };
})();
