(function () {
  const $ = (id) => document.getElementById(id);
  let recapGrid, listEl;

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

  function renderRecap(recap) {
    recapGrid.innerHTML = '';
    RECAP_TILES.forEach(({ key, icon, label }) => {
      const tile = document.createElement('div');
      tile.className = 'recap-tile';
      tile.innerHTML = `<span class="recap-value">${icon} ${recap[key] || 0}</span><span class="recap-label">${label}</span>`;
      recapGrid.appendChild(tile);
    });
    const sinceTile = document.createElement('div');
    sinceTile.className = 'recap-tile';
    const sinceText = recap.firstEventAt
      ? new Date(recap.firstEventAt).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })
      : '—';
    sinceTile.innerHTML = `<span class="recap-value">📅</span><span class="recap-label">together since ${sinceText}</span>`;
    recapGrid.appendChild(sinceTile);
  }

  function renderHistory(history) {
    listEl.innerHTML = '';
    if (!history.length) {
      const empty = document.createElement('p');
      empty.id = 'history-empty';
      empty.textContent = 'no memories yet — go make some 💕';
      listEl.appendChild(empty);
      return;
    }
    [...history].reverse().forEach((ev) => {
      const describe = DESCRIBE[ev.type];
      if (!describe) return;
      const li = document.createElement('li');
      li.className = 'side-' + ev.side;
      const icon = ev.side === 'blue' ? '💙' : '💗';
      li.innerHTML = `<span>${icon} ${describe(ev.details || {})}</span><span class="history-time">${formatTime(ev.ts)}</span>`;
      listEl.appendChild(li);
    });
  }

  let wired = false;
  function wireOnce() {
    if (wired) return;
    wired = true;
    recapGrid = $('recap-grid');
    listEl = $('history-list');
  }

  window.registerGame('history', {
    enter() {
      wireOnce();
      Promise.all([
        window.App.apiGet('/api/recap'),
        window.App.apiGet('/api/history'),
      ]).then(([recap, history]) => {
        renderRecap(recap);
        renderHistory(history);
      }).catch((err) => {
        console.warn('[history] failed to load', err);
        listEl.innerHTML = '<p id="history-empty">couldn\'t load history right now</p>';
      });
    },
  });
})();
