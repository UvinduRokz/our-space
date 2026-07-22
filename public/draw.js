(function () {
  const $ = (id) => document.getElementById(id);
  const SWATCHES = ['#1a1a1a', '#ffffff', '#e74c3c', '#f39c12', '#f1c40f', '#2ecc71', '#1abc9c', '#4f8fff', '#ff5fa8', '#9b59b6'];

  let canvas, ctx, statusEl;
  let colorBtn, sizeBtn, eraserBtn, undoBtn, redoBtn, gridBtn, clearBtn, finishBtn;
  let colorPopover, sizePopover, sizeSlider, sizeValueEl, colorCustomInput;
  let gridOverlay;
  let revealModal, revealImg, revealCloseBtn;

  let dpr = 1;
  let isDrawing = false;
  let lastLocalPoint = null;
  let pendingPoints = [];
  let rafScheduled = false;
  let strokes = { blue: [], pink: [] };

  let currentColor = '#1a1a1a';
  let currentWidth = 4;
  let isErasing = false;
  let statusTimer = null;

  function showDrawStatus(message) {
    statusEl.textContent = message;
    statusEl.classList.add('show');
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => statusEl.classList.remove('show'), 2200);
  }

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    redrawAll();
  }

  function toFrac(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: (clientX - rect.left) / rect.width,
      y: (clientY - rect.top) / rect.height,
    };
  }

  function clampFrac(side, p) {
    const x = side === 'blue' ? Math.min(p.x, 0.5) : Math.max(p.x, 0.5);
    return { x, y: Math.min(Math.max(p.y, 0), 1) };
  }

  function drawSegment(stroke, from, to) {
    const rect = canvas.getBoundingClientRect();
    ctx.globalCompositeOperation = stroke.erase ? 'destination-out' : 'source-over';
    ctx.strokeStyle = stroke.color || '#000000';
    ctx.lineWidth = stroke.width || 4;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(from.x * rect.width, from.y * rect.height);
    ctx.lineTo(to.x * rect.width, to.y * rect.height);
    ctx.stroke();
    ctx.globalCompositeOperation = 'source-over';
  }

  function redrawAll() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ['blue', 'pink'].forEach((side) => {
      (strokes[side] || []).forEach((stroke) => {
        const pts = stroke.points || [];
        for (let i = 1; i < pts.length; i++) drawSegment(stroke, pts[i - 1], pts[i]);
      });
    });
  }

  function scheduleFlush() {
    if (rafScheduled) return;
    rafScheduled = true;
    requestAnimationFrame(() => {
      rafScheduled = false;
      flushPending();
    });
  }

  function flushPending() {
    if (!pendingPoints.length) return;
    window.App.socket.emit('draw:stroke-points', { points: pendingPoints });
    pendingPoints = [];
  }

  function onPointerDown(e) {
    const side = window.App.side;
    const p = toFrac(e.clientX, e.clientY);
    const onOwnHalf = side === 'blue' ? p.x <= 0.5 : p.x >= 0.5;
    if (!onOwnHalf) return;
    isDrawing = true;
    canvas.setPointerCapture(e.pointerId);
    const cp = clampFrac(side, p);
    lastLocalPoint = cp;
    const stroke = { color: currentColor, width: currentWidth, erase: isErasing, points: [cp] };
    strokes[side].push(stroke);
    window.App.socket.emit('draw:stroke-start', { x: cp.x, y: cp.y, color: currentColor, width: currentWidth, erase: isErasing });
  }

  function onPointerMove(e) {
    if (!isDrawing) return;
    const side = window.App.side;
    const strokeList = strokes[side];
    const stroke = strokeList[strokeList.length - 1];
    const p = clampFrac(side, toFrac(e.clientX, e.clientY));
    drawSegment(stroke, lastLocalPoint, p);
    stroke.points.push(p);
    lastLocalPoint = p;
    pendingPoints.push(p);
    scheduleFlush();
  }

  function onPointerUp() {
    if (!isDrawing) return;
    isDrawing = false;
    lastLocalPoint = null;
    flushPending();
  }

  function onRemoteState(state) {
    strokes = { blue: state.blue || [], pink: state.pink || [] };
    redrawAll();
  }

  function onRemoteStart({ side, point, color, width, erase }) {
    if (side === window.App.side) return; // our own, already drawn locally
    strokes[side].push({ color, width, erase, points: [point] });
  }

  function onRemotePoints({ side, points }) {
    if (side === window.App.side) return;
    const strokeList = strokes[side];
    if (!strokeList.length) return;
    const stroke = strokeList[strokeList.length - 1];
    let prev = stroke.points.length ? stroke.points[stroke.points.length - 1] : points[0];
    points.forEach((p) => {
      drawSegment(stroke, prev, p);
      stroke.points.push(p);
      prev = p;
    });
  }

  function onUndo({ side }) {
    if (!strokes[side].length) return;
    strokes[side].pop();
    redrawAll();
  }

  function onRedo({ side, stroke }) {
    strokes[side].push(stroke);
    redrawAll();
  }

  function onCleared() {
    strokes = { blue: [], pink: [] };
    redrawAll();
  }

  function closeAllPopovers() {
    colorPopover.classList.add('hidden');
    sizePopover.classList.add('hidden');
  }

  function renderColorSwatches() {
    const container = colorPopover.querySelector('#draw-color-swatches');
    container.innerHTML = '';
    SWATCHES.forEach((color) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'draw-swatch' + (color === currentColor ? ' active' : '');
      btn.style.background = color;
      btn.addEventListener('click', () => {
        currentColor = color;
        isErasing = false;
        eraserBtn.classList.remove('active');
        closeAllPopovers();
      });
      container.appendChild(btn);
    });
  }

  async function onFinishClick() {
    const exportCanvas = document.createElement('canvas');
    exportCanvas.width = canvas.width;
    exportCanvas.height = canvas.height;
    const exportCtx = exportCanvas.getContext('2d');
    exportCtx.fillStyle = '#fbfbfa';
    exportCtx.fillRect(0, 0, exportCanvas.width, exportCanvas.height);
    exportCtx.drawImage(canvas, 0, 0);
    const dataUrl = exportCanvas.toDataURL('image/png');

    try {
      const saved = await window.App.apiPost('/api/drawings', { image: dataUrl });
      revealImg.src = saved.url;
      revealModal.classList.remove('hidden');
    } catch (err) {
      console.error('[draw] failed to save drawing', err);
      showDrawStatus("couldn't save — try again");
    }
  }

  function onRevealClose() {
    revealModal.classList.add('hidden');
    window.App.socket.emit('draw:clear');
  }

  function onClearClick() {
    if (!confirm('Clear the whole drawing for both of you? (not saved)')) return;
    window.App.socket.emit('draw:clear');
  }

  let wired = false;
  function wireOnce() {
    if (wired) return;
    wired = true;
    canvas = $('draw-canvas');
    ctx = canvas.getContext('2d');
    statusEl = $('draw-status');
    gridOverlay = $('draw-grid-overlay');

    colorBtn = $('draw-tool-color');
    sizeBtn = $('draw-tool-size');
    eraserBtn = $('draw-tool-eraser');
    undoBtn = $('draw-tool-undo');
    redoBtn = $('draw-tool-redo');
    gridBtn = $('draw-tool-grid');
    clearBtn = $('draw-tool-clear');
    finishBtn = $('draw-tool-finish');

    colorPopover = $('draw-color-popover');
    sizePopover = $('draw-size-popover');
    sizeSlider = $('draw-size-slider');
    sizeValueEl = $('draw-size-value');
    colorCustomInput = $('draw-color-custom');

    revealModal = $('drawing-reveal');
    revealImg = $('drawing-reveal-img');
    revealCloseBtn = $('drawing-reveal-close');

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerUp);
    window.addEventListener('resize', resize);

    colorBtn.addEventListener('click', () => {
      const willShow = colorPopover.classList.contains('hidden');
      closeAllPopovers();
      renderColorSwatches();
      if (willShow) colorPopover.classList.remove('hidden');
    });
    sizeBtn.addEventListener('click', () => {
      const willShow = sizePopover.classList.contains('hidden');
      closeAllPopovers();
      if (willShow) sizePopover.classList.remove('hidden');
    });
    colorCustomInput.addEventListener('input', () => {
      currentColor = colorCustomInput.value;
      isErasing = false;
      eraserBtn.classList.remove('active');
    });
    sizeSlider.addEventListener('input', () => {
      currentWidth = Number(sizeSlider.value);
      sizeValueEl.textContent = currentWidth + 'px';
    });
    eraserBtn.addEventListener('click', () => {
      isErasing = !isErasing;
      eraserBtn.classList.toggle('active', isErasing);
      closeAllPopovers();
    });
    gridBtn.addEventListener('click', () => {
      gridOverlay.classList.toggle('hidden');
      gridBtn.classList.toggle('active', !gridOverlay.classList.contains('hidden'));
    });
    undoBtn.addEventListener('click', () => window.App.socket.emit('draw:undo'));
    redoBtn.addEventListener('click', () => window.App.socket.emit('draw:redo'));
    clearBtn.addEventListener('click', onClearClick);
    finishBtn.addEventListener('click', onFinishClick);
    revealCloseBtn.addEventListener('click', onRevealClose);
  }

  window.registerGame('game-draw', {
    enter() {
      wireOnce();
      sizeSlider.value = currentWidth;
      sizeValueEl.textContent = currentWidth + 'px';
      window.App.socket.on('draw:state', onRemoteState);
      window.App.socket.on('draw:stroke-start', onRemoteStart);
      window.App.socket.on('draw:stroke-points', onRemotePoints);
      window.App.socket.on('draw:undo', onUndo);
      window.App.socket.on('draw:redo', onRedo);
      window.App.socket.on('draw:cleared', onCleared);
      resize();
      window.App.socket.emit('draw:sync');
    },
    leave() {
      isDrawing = false;
      lastLocalPoint = null;
      closeAllPopovers();
      window.App.socket.off('draw:state', onRemoteState);
      window.App.socket.off('draw:stroke-start', onRemoteStart);
      window.App.socket.off('draw:stroke-points', onRemotePoints);
      window.App.socket.off('draw:undo', onUndo);
      window.App.socket.off('draw:redo', onRedo);
      window.App.socket.off('draw:cleared', onCleared);
    },
  });
})();
