(function () {
  const $ = (id) => document.getElementById(id);
  let grid, lightbox, lightboxImg, lightboxDownload, lightboxClose;

  function formatDate(ts) {
    return new Date(ts).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function openLightbox(drawing) {
    lightboxImg.src = drawing.url;
    lightboxDownload.href = drawing.url;
    lightboxDownload.download = `drawing-${drawing.id}.png`;
    lightbox.classList.remove('hidden');
  }

  function render(drawings) {
    grid.innerHTML = '';
    if (!drawings.length) {
      const empty = document.createElement('p');
      empty.id = 'history-empty';
      empty.textContent = 'no drawings saved yet — go make one 💕';
      grid.appendChild(empty);
      return;
    }
    drawings.forEach((d) => {
      const tile = document.createElement('div');
      tile.className = 'gallery-tile';
      tile.innerHTML = `
        <img src="${d.url}" alt="a saved drawing" loading="lazy" />
        <span class="gallery-tile-tag">${d.side === 'blue' ? '💙' : '💗'}</span>
        <span class="gallery-tile-date">${formatDate(d.ts)}</span>
      `;
      tile.addEventListener('click', () => openLightbox(d));
      grid.appendChild(tile);
    });
  }

  let wired = false;
  function wireOnce() {
    if (wired) return;
    wired = true;
    grid = $('gallery-grid');
    lightbox = $('gallery-lightbox');
    lightboxImg = $('gallery-lightbox-img');
    lightboxDownload = $('gallery-lightbox-download');
    lightboxClose = $('gallery-lightbox-close');
    lightboxClose.addEventListener('click', () => lightbox.classList.add('hidden'));
  }

  window.registerGame('gallery', {
    enter() {
      wireOnce();
      window.App.apiGet('/api/drawings')
        .then(render)
        .catch((err) => {
          console.warn('[gallery] failed to load', err);
          grid.innerHTML = '<p id="history-empty">couldn\'t load the gallery right now</p>';
        });
    },
  });
})();
