import { useEffect, useRef, useState } from 'react';
import { useApp } from '../context/AppContext.jsx';
import BackButton from '../components/BackButton.jsx';
import Modal from '../components/Modal.jsx';
import './DrawScreen.css';

const SWATCHES = ['#1a1a1a', '#ffffff', '#e74c3c', '#f39c12', '#f1c40f', '#2ecc71', '#1abc9c', '#4f8fff', '#ff5fa8', '#9b59b6'];

export default function DrawScreen() {
  const { socket, side, profile, apiPost, partnerActivity } = useApp();
  const partnerHere = partnerActivity === 'draw';

  const canvasRef = useRef(null);
  const ctxRef = useRef(null);
  // Mutable drawing engine state that must NOT trigger React re-renders on
  // every pointer move — canvas drawing stays imperative, same as the old
  // vanilla module's closure variables, just held in a ref instead.
  const engineRef = useRef({
    dpr: 1,
    isDrawing: false,
    lastLocalPoint: null,
    pendingPoints: [],
    rafScheduled: false,
    strokes: { blue: [], pink: [] },
  });
  // latest tool settings, readable from the stable (attached-once) pointer
  // handlers without needing to re-bind listeners whenever a tool changes
  const toolRef = useRef({ color: '#1a1a1a', width: 4, erasing: false });

  const [currentColor, setCurrentColor] = useState('#1a1a1a');
  const [currentWidth, setCurrentWidth] = useState(4);
  const [isErasing, setIsErasing] = useState(false);
  const [colorPopoverOpen, setColorPopoverOpen] = useState(false);
  const [sizePopoverOpen, setSizePopoverOpen] = useState(false);
  const [gridVisible, setGridVisible] = useState(false);
  const [status, setStatus] = useState({ text: '', show: false });
  const [reveal, setReveal] = useState(null); // saved drawing url, or null
  const statusTimerRef = useRef(null);

  useEffect(() => {
    toolRef.current = { color: currentColor, width: currentWidth, erasing: isErasing };
  }, [currentColor, currentWidth, isErasing]);

  function showDrawStatus(message) {
    setStatus({ text: message, show: true });
    clearTimeout(statusTimerRef.current);
    statusTimerRef.current = setTimeout(() => setStatus((s) => ({ ...s, show: false })), 2200);
  }

  function toFrac(clientX, clientY) {
    const rect = canvasRef.current.getBoundingClientRect();
    return { x: (clientX - rect.left) / rect.width, y: (clientY - rect.top) / rect.height };
  }

  function clampFrac(p) {
    const x = side === 'blue' ? Math.min(p.x, 0.5) : Math.max(p.x, 0.5);
    return { x, y: Math.min(Math.max(p.y, 0), 1) };
  }

  function drawSegment(stroke, from, to) {
    const canvas = canvasRef.current;
    const ctx = ctxRef.current;
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
    const canvas = canvasRef.current;
    const ctx = ctxRef.current;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const strokes = engineRef.current.strokes;
    ['blue', 'pink'].forEach((s) => {
      (strokes[s] || []).forEach((stroke) => {
        const pts = stroke.points || [];
        for (let i = 1; i < pts.length; i++) drawSegment(stroke, pts[i - 1], pts[i]);
      });
    });
  }

  function resize() {
    const canvas = canvasRef.current;
    const ctx = ctxRef.current;
    const eng = engineRef.current;
    eng.dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * eng.dpr;
    canvas.height = rect.height * eng.dpr;
    ctx.setTransform(eng.dpr, 0, 0, eng.dpr, 0, 0);
    redrawAll();
  }

  useEffect(() => {
    if (!socket) return;
    const canvas = canvasRef.current;
    ctxRef.current = canvas.getContext('2d');
    const eng = engineRef.current;

    function flushPending() {
      if (!eng.pendingPoints.length) return;
      socket.emit('draw:stroke-points', { points: eng.pendingPoints });
      eng.pendingPoints = [];
    }
    function scheduleFlush() {
      if (eng.rafScheduled) return;
      eng.rafScheduled = true;
      requestAnimationFrame(() => {
        eng.rafScheduled = false;
        flushPending();
      });
    }

    function onPointerDown(e) {
      const p = toFrac(e.clientX, e.clientY);
      const onOwnHalf = side === 'blue' ? p.x <= 0.5 : p.x >= 0.5;
      if (!onOwnHalf) return;
      eng.isDrawing = true;
      canvas.setPointerCapture(e.pointerId);
      const cp = clampFrac(p);
      eng.lastLocalPoint = cp;
      const { color, width, erasing } = toolRef.current;
      const stroke = { color, width, erase: erasing, points: [cp] };
      eng.strokes[side].push(stroke);
      socket.emit('draw:stroke-start', { x: cp.x, y: cp.y, color, width, erase: erasing });
    }

    function onPointerMove(e) {
      if (!eng.isDrawing) return;
      const strokeList = eng.strokes[side];
      const stroke = strokeList[strokeList.length - 1];
      const p = clampFrac(toFrac(e.clientX, e.clientY));
      drawSegment(stroke, eng.lastLocalPoint, p);
      stroke.points.push(p);
      eng.lastLocalPoint = p;
      eng.pendingPoints.push(p);
      scheduleFlush();
    }

    function onPointerUp() {
      if (!eng.isDrawing) return;
      eng.isDrawing = false;
      eng.lastLocalPoint = null;
      flushPending();
    }

    function onRemoteState(state) {
      eng.strokes = { blue: state.blue || [], pink: state.pink || [] };
      redrawAll();
    }
    function onRemoteStart({ side: fromSide, point, color, width, erase }) {
      if (fromSide === side) return; // our own, already drawn locally
      eng.strokes[fromSide].push({ color, width, erase, points: [point] });
    }
    function onRemotePoints({ side: fromSide, points }) {
      if (fromSide === side) return;
      const strokeList = eng.strokes[fromSide];
      if (!strokeList.length) return;
      const stroke = strokeList[strokeList.length - 1];
      let prev = stroke.points.length ? stroke.points[stroke.points.length - 1] : points[0];
      points.forEach((p) => {
        drawSegment(stroke, prev, p);
        stroke.points.push(p);
        prev = p;
      });
    }
    function onUndo({ side: fromSide }) {
      if (!eng.strokes[fromSide].length) return;
      eng.strokes[fromSide].pop();
      redrawAll();
    }
    function onRedo({ side: fromSide, stroke }) {
      eng.strokes[fromSide].push(stroke);
      redrawAll();
    }
    function onCleared() {
      eng.strokes = { blue: [], pink: [] };
      redrawAll();
    }

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerUp);
    window.addEventListener('resize', resize);

    socket.on('draw:state', onRemoteState);
    socket.on('draw:stroke-start', onRemoteStart);
    socket.on('draw:stroke-points', onRemotePoints);
    socket.on('draw:undo', onUndo);
    socket.on('draw:redo', onRedo);
    socket.on('draw:cleared', onCleared);

    resize();
    socket.emit('draw:sync');

    return () => {
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerUp);
      window.removeEventListener('resize', resize);
      socket.off('draw:state', onRemoteState);
      socket.off('draw:stroke-start', onRemoteStart);
      socket.off('draw:stroke-points', onRemotePoints);
      socket.off('draw:undo', onUndo);
      socket.off('draw:redo', onRedo);
      socket.off('draw:cleared', onCleared);
      eng.isDrawing = false;
      eng.lastLocalPoint = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socket, side]);

  function selectSwatch(color) {
    setCurrentColor(color);
    setIsErasing(false);
    setColorPopoverOpen(false);
  }

  function handleCustomColor(e) {
    setCurrentColor(e.target.value);
    setIsErasing(false);
  }

  function toggleEraser() {
    setIsErasing((v) => !v);
    setColorPopoverOpen(false);
    setSizePopoverOpen(false);
  }

  function toggleColorPopover() {
    setSizePopoverOpen(false);
    setColorPopoverOpen((v) => !v);
  }

  function toggleSizePopover() {
    setColorPopoverOpen(false);
    setSizePopoverOpen((v) => !v);
  }

  async function handleFinish() {
    const canvas = canvasRef.current;
    const exportCanvas = document.createElement('canvas');
    exportCanvas.width = canvas.width;
    exportCanvas.height = canvas.height;
    const exportCtx = exportCanvas.getContext('2d');
    exportCtx.fillStyle = '#fbfbfa';
    exportCtx.fillRect(0, 0, exportCanvas.width, exportCanvas.height);
    exportCtx.drawImage(canvas, 0, 0);
    const dataUrl = exportCanvas.toDataURL('image/png');
    try {
      const saved = await apiPost('/api/drawings', { image: dataUrl });
      setReveal(saved.url);
    } catch (err) {
      console.error('[draw] failed to save drawing', err);
      showDrawStatus("couldn't save — try again");
    }
  }

  function handleRevealClose() {
    setReveal(null);
    socket.emit('draw:clear');
  }

  function handleClear() {
    if (!window.confirm('Clear the whole drawing for both of you? (not saved)')) return;
    socket.emit('draw:clear');
  }

  return (
    <section className="screen draw-screen">
      <div className="draw-backdrop" />
      <canvas ref={canvasRef} className="draw-canvas" />
      <div className="draw-guides">
        {gridVisible && <div className="draw-grid-overlay" />}
        <div className="draw-divider" />
        <span className="draw-tag draw-tag-left">💙</span>
        <span className="draw-tag draw-tag-right">💗</span>
      </div>

      <BackButton to="activities" />
      <p className={`draw-status${status.show ? ' show' : ''}`}>{status.text}</p>

      <div className="draw-toolbar">
        <button type="button" className="draw-tool" title="Color" onClick={toggleColorPopover}>🎨</button>
        <button type="button" className="draw-tool" title="Brush size" onClick={toggleSizePopover}>✏️</button>
        <button type="button" className={`draw-tool${isErasing ? ' active' : ''}`} title="Eraser" onClick={toggleEraser}>🧹</button>
        <button type="button" className="draw-tool" title="Undo" onClick={() => socket.emit('draw:undo')}>↩️</button>
        <button type="button" className="draw-tool" title="Redo" onClick={() => socket.emit('draw:redo')}>↪️</button>
        <button type="button" className={`draw-tool${gridVisible ? ' active' : ''}`} title="Grid" onClick={() => setGridVisible((v) => !v)}>▦</button>
        <button type="button" className="draw-tool" title="Clear" onClick={handleClear}>🗑️</button>
        <button type="button" className="draw-tool draw-tool-primary" title="Finish &amp; Save" onClick={handleFinish}>✅</button>
      </div>

      {colorPopoverOpen && (
        <div className="draw-popover">
          <div className="draw-color-swatches">
            {SWATCHES.map((color) => (
              <button
                type="button"
                key={color}
                className={`draw-swatch${color === currentColor ? ' active' : ''}`}
                style={{ background: color }}
                onClick={() => selectSwatch(color)}
              />
            ))}
          </div>
          <input type="color" className="draw-color-custom" value={currentColor} onChange={handleCustomColor} />
        </div>
      )}

      {sizePopoverOpen && (
        <div className="draw-popover">
          <input type="range" min="2" max="24" value={currentWidth} onChange={(e) => setCurrentWidth(Number(e.target.value))} />
          <span className="draw-size-value">{currentWidth}px</span>
        </div>
      )}

      {!partnerHere && (
        <div className="waiting-overlay">
          <p>waiting for {profile.partnerNickname} to open this page before you can draw together…</p>
        </div>
      )}

      {reveal && (
        <Modal onClose={handleRevealClose}>
          <img src={reveal} alt="your finished drawing" />
        </Modal>
      )}
    </section>
  );
}
