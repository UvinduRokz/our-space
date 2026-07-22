(function () {
  const $ = (id) => document.getElementById(id);
  let grid, input, statusEl, newBtn;
  let state = null; // last known server state
  let remoteTyping = ''; // partner's in-progress letters, when it's their turn

  function renderGrid() {
    grid.innerHTML = '';
    const maxGuesses = (state && state.maxGuesses) || 6;
    const guesses = (state && state.guesses) || [];
    const activeRowIndex = guesses.length;
    const isMyTurn = state && state.status === 'playing' && state.turn === window.App.side;
    const activeText = state && state.status === 'playing'
      ? (isMyTurn ? (input ? input.value : '') : remoteTyping)
      : '';

    for (let row = 0; row < maxGuesses; row++) {
      for (let col = 0; col < 5; col++) {
        const tile = document.createElement('div');
        tile.className = 'wordle-tile';
        if (row < guesses.length) {
          const g = guesses[row];
          tile.textContent = g.word[col];
          tile.classList.add(g.result[col]);
        } else if (row === activeRowIndex && activeText[col]) {
          tile.textContent = activeText[col];
          tile.classList.add('typing');
        }
        grid.appendChild(tile);
      }
    }
  }

  function renderStatus() {
    if (!state) {
      statusEl.textContent = 'connecting…';
      return;
    }
    if (state.status === 'won') {
      statusEl.textContent = `you got it! the word was ${state.target.toUpperCase()} 🎉`;
    } else if (state.status === 'lost') {
      statusEl.textContent = `out of guesses — it was ${state.target.toUpperCase()}`;
    } else {
      const isMyTurn = state.turn === window.App.side;
      const nick = window.App.profile.partnerNickname || 'babe';
      statusEl.textContent = isMyTurn ? 'your turn — type a guess' : `${nick}'s turn — watch them type…`;
    }
    newBtn.classList.toggle('hidden', state.status === 'playing');
    input.disabled = !state || state.status !== 'playing' || state.turn !== window.App.side;
    if (!input.disabled) input.value = input.value || '';
  }

  function render() {
    renderGrid();
    renderStatus();
  }

  function onState(newState) {
    const prevState = state;
    state = newState;
    remoteTyping = '';
    input.value = '';

    // guard against playing sfx on the very first sync when entering the
    // screen — only react to genuine, newly-arrived changes
    if (prevState) {
      if (newState.guesses.length > prevState.guesses.length) window.SFX.play('submit');
      if (prevState.status === 'playing' && newState.status === 'won') window.SFX.play('win');
      else if (prevState.status === 'playing' && newState.status === 'lost') window.SFX.play('lose');
    }

    render();
  }

  function onTyping({ text }) {
    remoteTyping = text || '';
    render();
  }

  function onInput() {
    const clean = input.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 5);
    if (clean !== input.value) input.value = clean;
    window.App.socket.volatile.emit('wordle:type', { text: clean });
    render();
  }

  function onKeydown(e) {
    if (e.key !== 'Enter') return;
    const word = input.value.trim();
    if (word.length !== 5) return;
    window.App.socket.emit('wordle:guess', { word });
  }

  function onNewGame() {
    window.App.socket.emit('wordle:new');
  }

  let wired = false;
  function wireOnce() {
    if (wired) return;
    wired = true;
    grid = $('wordle-grid');
    input = $('wordle-input');
    statusEl = $('wordle-status');
    newBtn = $('wordle-new-btn');
    input.addEventListener('input', onInput);
    input.addEventListener('keydown', onKeydown);
    newBtn.addEventListener('click', onNewGame);
  }

  window.registerGame('game-wordle', {
    enter() {
      wireOnce();
      window.App.socket.on('wordle:state', onState);
      window.App.socket.on('wordle:typing', onTyping);
      window.App.socket.emit('wordle:sync');
      render();
    },
    leave() {
      window.App.socket.off('wordle:state', onState);
      window.App.socket.off('wordle:typing', onTyping);
    },
  });
})();
