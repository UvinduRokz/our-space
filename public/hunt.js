(function () {
  const $ = (id) => document.getElementById(id);
  let lettersEl, form, input, errorEl, progressEl, foundList, newBtn, statusEl;
  let state = null;

  function render() {
    if (!state) {
      statusEl.textContent = 'connecting…';
      return;
    }
    statusEl.textContent = state.found.length >= state.target
      ? 'you found 10 together! 🎉'
      : 'find 10 words together';

    lettersEl.innerHTML = '';
    state.letters.forEach((l) => {
      const tile = document.createElement('div');
      tile.className = 'hunt-letter';
      tile.textContent = l;
      lettersEl.appendChild(tile);
    });

    progressEl.textContent = `${state.found.length} / ${state.target} found`;

    foundList.innerHTML = '';
    state.found.forEach((f) => {
      const li = document.createElement('li');
      li.textContent = f.word;
      li.className = 'side-' + f.by;
      foundList.appendChild(li);
    });
  }

  function onState(newState) {
    const prevState = state;
    state = newState;
    errorEl.textContent = '';

    // guard against playing sfx on the very first sync when entering the
    // screen — only react to genuine, newly-arrived changes
    if (prevState && newState.found.length > prevState.found.length) {
      window.SFX.play(newState.found.length >= newState.target ? 'complete' : 'found');
    }

    render();
  }

  function onInvalid({ reason }) {
    errorEl.textContent = reason || "that word doesn't work";
    setTimeout(() => { errorEl.textContent = ''; }, 2000);
  }

  function onSubmit(e) {
    e.preventDefault();
    const word = input.value.trim();
    if (!word) return;
    window.App.socket.emit('hunt:submit', { word });
    input.value = '';
  }

  function onNew() {
    window.App.socket.emit('hunt:new');
  }

  let wired = false;
  function wireOnce() {
    if (wired) return;
    wired = true;
    lettersEl = $('hunt-letters');
    form = $('hunt-form');
    input = $('hunt-input');
    errorEl = $('hunt-error');
    progressEl = $('hunt-progress');
    foundList = $('hunt-found');
    newBtn = $('hunt-new-btn');
    statusEl = $('hunt-status');
    form.addEventListener('submit', onSubmit);
    newBtn.addEventListener('click', onNew);
  }

  window.registerGame('game-hunt', {
    enter() {
      wireOnce();
      window.App.socket.on('hunt:state', onState);
      window.App.socket.on('hunt:invalid', onInvalid);
      window.App.socket.emit('hunt:sync');
      render();
    },
    leave() {
      window.App.socket.off('hunt:state', onState);
      window.App.socket.off('hunt:invalid', onInvalid);
    },
  });
})();
