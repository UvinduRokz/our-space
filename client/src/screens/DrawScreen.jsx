import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useApp } from '../context/AppContext.jsx';
import BackButton from '../components/BackButton.jsx';
import Modal from '../components/Modal.jsx';
import Tooltip from '../components/Tooltip.jsx';
import './DrawScreen.css';

// A Paint-style 20-swatch palette (two rows of 10) for quick access, instead
// of just a handful of swatches plus a native color picker as the only options.
const PALETTE = [
  '#000000', '#7f7f7f', '#880015', '#ed1c24', '#ff7f27', '#fff200', '#22b14c', '#00a2e8', '#3f48cc', '#a349a4',
  '#ffffff', '#c3c3c3', '#b97a57', '#ffaec9', '#ffc90e', '#efe4b0', '#b5e61d', '#99d9ea', '#7092be', '#c8bfe7',
];
const SHAPE_TOOL_TYPES = ['line', 'rect', 'ellipse', 'arrow'];
const DASH_STYLES = ['solid', 'dashed', 'dotted'];
const BRUSH_TYPES = ['pencil', 'brush', 'marker'];

// Fixed on purpose: the canvas used to just stretch to fill whichever
// device's screen it was on, so the same fractional stroke coordinates
// drew a different shape (circle vs. ellipse) for each partner. Locking
// both sides to one shared ratio and letterboxing it (see computeStageSize
// below) keeps strokes shaped the same everywhere, no matter the device.
const CANVAS_ASPECT = 9 / 16; // width / height — a tall "notebook page" that suits phones, pillarboxed on wide desktop screens

export default function DrawScreen() {
  const { socket, side, profile, apiPost, partnerActivity } = useApp();
  const partnerHere = partnerActivity === 'draw';

  const stageFrameRef = useRef(null);
  const canvasRef = useRef(null);
  const ctxRef = useRef(null);
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 });
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
    shapeStart: null, // fractional {x,y} where a shape drag began
    shapePreview: null, // in-progress shape object, local-only until pointerup commits it
  });
  // latest tool settings, readable from the stable (attached-once) pointer
  // handlers without needing to re-bind listeners whenever a tool changes
  const toolRef = useRef({
    tool: 'freehand', color: '#1a1a1a', width: 4, dash: 'solid', filled: false,
    brushType: 'pencil', gradient: false, color2: '#ffffff',
  });

  const [activeTool, setActiveTool] = useState('freehand'); // 'freehand' | 'eraser' | 'line' | 'rect' | 'ellipse' | 'arrow'
  const [lastShapeType, setLastShapeType] = useState('line');
  const [currentColor, setCurrentColor] = useState('#1a1a1a');
  const [secondColor, setSecondColor] = useState('#ffffff');
  const [currentWidth, setCurrentWidth] = useState(4);
  const [currentDash, setCurrentDash] = useState('solid');
  const [filled, setFilled] = useState(false);
  const [brushType, setBrushType] = useState('pencil');
  const [gradientOn, setGradientOn] = useState(false);
  const [colorSlot, setColorSlot] = useState('primary'); // which swatch the color popover is currently editing
  const [colorPopoverOpen, setColorPopoverOpen] = useState(false);
  const [sizePopoverOpen, setSizePopoverOpen] = useState(false);
  const [dashPopoverOpen, setDashPopoverOpen] = useState(false);
  const [fontSize, setFontSize] = useState(24);
  const [fontSizePopoverOpen, setFontSizePopoverOpen] = useState(false);
  const [textEditing, setTextEditing] = useState(null); // { x, y (fractional canvas point), value } while placing a text object
  const [gridVisible, setGridVisible] = useState(false);
  const [status, setStatus] = useState({ text: '', show: false });
  const [reveal, setReveal] = useState(null); // saved drawing url, or null
  const statusTimerRef = useRef(null);

  const activeCategory =
    activeTool === 'eraser' ? 'eraser' : activeTool === 'text' ? 'text' : SHAPE_TOOL_TYPES.includes(activeTool) ? 'shapes' : 'draw';

  useEffect(() => {
    toolRef.current = {
      tool: activeTool, color: currentColor, width: currentWidth, dash: currentDash, filled,
      brushType, gradient: gradientOn, color2: secondColor,
    };
  }, [activeTool, currentColor, currentWidth, currentDash, filled, brushType, gradientOn, secondColor]);

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

  // Shared stroke styling (color/gradient/width/dash/brush texture) for both
  // freehand segments and shapes — dash patterns scale with the stroke
  // width so thin and thick lines both read clearly as dashed/dotted.
  // `rect` (the canvas's CSS-pixel box) is needed to convert the object's
  // fractional endpoints into the pixel-space coordinates a canvas gradient
  // requires; freehand strokes use their first/last point as the gradient
  // vector, which naturally tracks the growing stroke while it's still
  // being drawn and settles once it's complete.
  function applyLineStyle(ctx, obj, rect) {
    const color1 = obj.color || '#000000';
    let styleColor = color1;
    if (obj.gradient && obj.color2 && rect && obj.points && obj.points.length >= 2) {
      const p0 = obj.points[0];
      const p1 = obj.points[obj.points.length - 1];
      const grad = ctx.createLinearGradient(p0.x * rect.width, p0.y * rect.height, p1.x * rect.width, p1.y * rect.height);
      grad.addColorStop(0, color1);
      grad.addColorStop(1, obj.color2);
      styleColor = grad;
    }
    ctx.strokeStyle = styleColor;
    ctx.fillStyle = styleColor;
    ctx.lineWidth = obj.width || 4;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (obj.dash === 'dashed') ctx.setLineDash([(obj.width || 4) * 2.5, (obj.width || 4) * 1.5]);
    else if (obj.dash === 'dotted') ctx.setLineDash([(obj.width || 4) * 0.6, (obj.width || 4) * 1.4]);
    else ctx.setLineDash([]);
    if (obj.brushType === 'brush') {
      ctx.shadowBlur = (obj.width || 4) * 1.2;
      ctx.shadowColor = color1;
    } else {
      ctx.shadowBlur = 0;
    }
    ctx.globalAlpha = obj.brushType === 'marker' ? 0.55 : 1;
  }

  function resetDrawState(ctx) {
    ctx.setLineDash([]);
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;
  }

  function drawSegment(stroke, from, to) {
    const canvas = canvasRef.current;
    const ctx = ctxRef.current;
    const rect = canvas.getBoundingClientRect();
    ctx.globalCompositeOperation = stroke.erase ? 'destination-out' : 'source-over';
    applyLineStyle(ctx, stroke, rect);
    ctx.beginPath();
    ctx.moveTo(from.x * rect.width, from.y * rect.height);
    ctx.lineTo(to.x * rect.width, to.y * rect.height);
    ctx.stroke();
    ctx.globalCompositeOperation = 'source-over';
    resetDrawState(ctx);
  }

  function drawArrowHead(ctx, from, to, width) {
    const angle = Math.atan2(to.y - from.y, to.x - from.x);
    const headLen = Math.max(10, width * 2.5);
    ctx.save();
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(to.x, to.y);
    ctx.lineTo(to.x - headLen * Math.cos(angle - Math.PI / 6), to.y - headLen * Math.sin(angle - Math.PI / 6));
    ctx.lineTo(to.x - headLen * Math.cos(angle + Math.PI / 6), to.y - headLen * Math.sin(angle + Math.PI / 6));
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function drawShape(obj) {
    const canvas = canvasRef.current;
    const ctx = ctxRef.current;
    const rect = canvas.getBoundingClientRect();
    const toPx = (p) => ({ x: p.x * rect.width, y: p.y * rect.height });
    const [p1, rawP2] = obj.points;
    const a = toPx(p1);
    const b = toPx(rawP2 || p1);
    applyLineStyle(ctx, obj, rect);

    if (obj.type === 'line') {
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    } else if (obj.type === 'arrow') {
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      drawArrowHead(ctx, a, b, obj.width || 4);
    } else if (obj.type === 'rect') {
      const x = Math.min(a.x, b.x);
      const y = Math.min(a.y, b.y);
      const w = Math.abs(b.x - a.x);
      const h = Math.abs(b.y - a.y);
      if (obj.filled) ctx.fillRect(x, y, w, h);
      else ctx.strokeRect(x, y, w, h);
    } else if (obj.type === 'ellipse') {
      const cx = (a.x + b.x) / 2;
      const cy = (a.y + b.y) / 2;
      const rx = Math.abs(b.x - a.x) / 2;
      const ry = Math.abs(b.y - a.y) / 2;
      ctx.beginPath();
      ctx.ellipse(cx, cy, Math.max(rx, 0.5), Math.max(ry, 0.5), 0, 0, Math.PI * 2);
      if (obj.filled) ctx.fill();
      else ctx.stroke();
    } else if (obj.type === 'text') {
      ctx.font = `${obj.fontSize || 24}px sans-serif`;
      ctx.textBaseline = 'top';
      ctx.fillText(obj.text || '', a.x, a.y);
    }
    resetDrawState(ctx);
  }

  function redrawAll() {
    const canvas = canvasRef.current;
    const ctx = ctxRef.current;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const strokes = engineRef.current.strokes;
    ['blue', 'pink'].forEach((s) => {
      (strokes[s] || []).forEach((obj) => {
        if (!obj.type || obj.type === 'freehand') {
          const pts = obj.points || [];
          for (let i = 1; i < pts.length; i++) drawSegment(obj, pts[i - 1], pts[i]);
        } else {
          drawShape(obj);
        }
      });
    });
    if (engineRef.current.shapePreview) drawShape(engineRef.current.shapePreview);
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

  // Largest box matching CANVAS_ASPECT that still fits inside the available
  // screen space — the letterboxing/pillarboxing that keeps the canvas's
  // shape identical on both partners' devices regardless of their own
  // screen's aspect ratio.
  function computeStageSize() {
    const frame = stageFrameRef.current;
    if (!frame) return;
    const availW = frame.clientWidth;
    const availH = frame.clientHeight;
    let width = availW;
    let height = width / CANVAS_ASPECT;
    if (height > availH) {
      height = availH;
      width = height * CANVAS_ASPECT;
    }
    setStageSize({ width, height });
  }

  useEffect(() => {
    computeStageSize();
    window.addEventListener('resize', computeStageSize);
    return () => window.removeEventListener('resize', computeStageSize);
  }, []);

  // Runs whenever the letterboxed stage box changes size — separate from
  // the socket-setup effect below so the canvas pixel buffer stays in sync
  // with the actual rendered box, not the full (unletterboxed) screen.
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !stageSize.width || !stageSize.height) return;
    if (!ctxRef.current) ctxRef.current = canvas.getContext('2d');
    resize();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stageSize]);

  useEffect(() => {
    if (!socket) return;
    const canvas = canvasRef.current;
    if (!ctxRef.current) ctxRef.current = canvas.getContext('2d');
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
      const cp = clampFrac(p);
      const { tool, color, width, dash, filled: isFilled, brushType: brush, gradient, color2 } = toolRef.current;

      if (tool === 'text') {
        // No pointer capture here (nothing to drag-track) and prevent the
        // default action — without it, the canvas (not focusable) still
        // "wins" the click and the browser resets focus to <body> right
        // after the floating input autofocuses, blurring it instantly and
        // discarding the text box before the user can type anything.
        e.preventDefault();
        setTextEditing({ x: cp.x, y: cp.y, value: '' });
        return;
      }

      canvas.setPointerCapture(e.pointerId);

      if (tool === 'freehand' || tool === 'eraser') {
        eng.isDrawing = true;
        eng.lastLocalPoint = cp;
        const erase = tool === 'eraser';
        const id = crypto.randomUUID();
        // dash/brush texture/gradient are decorative "draw" concepts that
        // don't make sense for an eraser — a dashed or translucent
        // destination-out stroke would erase unevenly, leaving gaps
        const strokeDash = erase ? 'solid' : dash;
        const strokeBrush = erase ? 'pencil' : brush;
        const strokeGradient = erase ? false : gradient;
        const stroke = { id, type: 'freehand', color, width, dash: strokeDash, erase, brushType: strokeBrush, points: [cp] };
        if (strokeGradient) {
          stroke.gradient = true;
          stroke.color2 = color2;
        }
        eng.strokes[side].push(stroke);
        socket.emit('draw:stroke-start', {
          id, x: cp.x, y: cp.y, color, width, dash: strokeDash, erase,
          brushType: strokeBrush, gradient: strokeGradient, color2: strokeGradient ? color2 : undefined,
        });
      } else if (SHAPE_TOOL_TYPES.includes(tool)) {
        eng.shapeStart = cp;
        const shape = { type: tool, color, width, dash, filled: isFilled, brushType: brush, points: [cp, cp] };
        if (gradient) {
          shape.gradient = true;
          shape.color2 = color2;
        }
        eng.shapePreview = shape;
        redrawAll();
      }
    }

    function onPointerMove(e) {
      const { tool } = toolRef.current;
      if (tool === 'freehand' || tool === 'eraser') {
        if (!eng.isDrawing) return;
        const strokeList = eng.strokes[side];
        const stroke = strokeList[strokeList.length - 1];
        const p = clampFrac(toFrac(e.clientX, e.clientY));
        drawSegment(stroke, eng.lastLocalPoint, p);
        stroke.points.push(p);
        eng.lastLocalPoint = p;
        eng.pendingPoints.push(p);
        scheduleFlush();
      } else if (SHAPE_TOOL_TYPES.includes(tool)) {
        if (!eng.shapePreview) return;
        const p = clampFrac(toFrac(e.clientX, e.clientY));
        eng.shapePreview.points = [eng.shapeStart, p];
        redrawAll();
      }
    }

    function onPointerUp() {
      const { tool } = toolRef.current;
      if (tool === 'freehand' || tool === 'eraser') {
        if (!eng.isDrawing) return;
        eng.isDrawing = false;
        eng.lastLocalPoint = null;
        flushPending();
      } else if (SHAPE_TOOL_TYPES.includes(tool)) {
        if (!eng.shapePreview) return;
        const shape = eng.shapePreview;
        eng.shapePreview = null;
        eng.shapeStart = null;
        const [p1, p2] = shape.points;
        // ignore a near-zero drag (an accidental tap rather than a real shape)
        if (Math.hypot(p2.x - p1.x, p2.y - p1.y) < 0.006) {
          redrawAll();
          return;
        }
        const id = crypto.randomUUID();
        eng.strokes[side].push({ id, ...shape });
        socket.emit('draw:shape-commit', {
          id,
          type: shape.type,
          color: shape.color,
          width: shape.width,
          dash: shape.dash,
          filled: shape.filled,
          brushType: shape.brushType,
          gradient: shape.gradient,
          color2: shape.color2,
          points: shape.points,
        });
        redrawAll();
      }
    }

    function onRemoteState(state) {
      eng.strokes = { blue: state.blue || [], pink: state.pink || [] };
      redrawAll();
    }
    function onRemoteStart({ side: fromSide, id, point, color, width, dash, erase, brushType: brush, gradient, color2 }) {
      if (fromSide === side) return; // our own, already drawn locally
      const stroke = { id, type: 'freehand', color, width, dash, erase, brushType: brush, points: [point] };
      if (gradient) {
        stroke.gradient = true;
        stroke.color2 = color2;
      }
      eng.strokes[fromSide].push(stroke);
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
    function onShapeCommit({ side: fromSide, object }) {
      if (fromSide === side) return; // our own, already added locally on pointerup
      eng.strokes[fromSide].push(object);
      redrawAll();
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

    socket.on('draw:state', onRemoteState);
    socket.on('draw:stroke-start', onRemoteStart);
    socket.on('draw:stroke-points', onRemotePoints);
    socket.on('draw:shape-commit', onShapeCommit);
    socket.on('draw:undo', onUndo);
    socket.on('draw:redo', onRedo);
    socket.on('draw:cleared', onCleared);

    socket.emit('draw:sync');

    return () => {
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerUp);
      socket.off('draw:state', onRemoteState);
      socket.off('draw:stroke-start', onRemoteStart);
      socket.off('draw:stroke-points', onRemotePoints);
      socket.off('draw:shape-commit', onShapeCommit);
      socket.off('draw:undo', onUndo);
      socket.off('draw:redo', onRedo);
      socket.off('draw:cleared', onCleared);
      eng.isDrawing = false;
      eng.lastLocalPoint = null;
      eng.shapeStart = null;
      eng.shapePreview = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socket, side]);

  function switchTool(tool) {
    setActiveTool(tool);
    setColorPopoverOpen(false);
    setSizePopoverOpen(false);
    setDashPopoverOpen(false);
    setFontSizePopoverOpen(false);
    commitText();
  }
  function selectDrawCategory() {
    switchTool('freehand');
  }
  function selectShapesCategory() {
    switchTool(lastShapeType);
  }
  function selectShapeType(type) {
    setLastShapeType(type);
    switchTool(type);
  }
  function selectEraserCategory() {
    switchTool('eraser');
  }
  function selectTextCategory() {
    switchTool('text');
  }

  function commitText() {
    setTextEditing((editing) => {
      if (!editing) return null;
      const value = editing.value.trim();
      if (value) {
        const id = crypto.randomUUID();
        const obj = { id, type: 'text', color: currentColor, fontSize, points: [{ x: editing.x, y: editing.y }], text: value };
        engineRef.current.strokes[side].push(obj);
        socket.emit('draw:shape-commit', { id, type: 'text', color: currentColor, fontSize, points: [{ x: editing.x, y: editing.y }], text: value });
        redrawAll();
      }
      return null;
    });
  }
  function cancelText() {
    setTextEditing(null);
  }

  function selectSwatch(color) {
    if (colorSlot === 'secondary') setSecondColor(color);
    else setCurrentColor(color);
    setColorPopoverOpen(false);
  }

  function handleCustomColor(e) {
    if (colorSlot === 'secondary') setSecondColor(e.target.value);
    else setCurrentColor(e.target.value);
  }

  function openColorPopoverFor(slot) {
    setColorSlot(slot);
    setSizePopoverOpen(false);
    setDashPopoverOpen(false);
    setFontSizePopoverOpen(false);
    setColorPopoverOpen(true);
  }

  function toggleColorPopover() {
    setSizePopoverOpen(false);
    setDashPopoverOpen(false);
    setFontSizePopoverOpen(false);
    setColorSlot('primary');
    setColorPopoverOpen((v) => !v);
  }

  function toggleSizePopover() {
    setColorPopoverOpen(false);
    setDashPopoverOpen(false);
    setFontSizePopoverOpen(false);
    setSizePopoverOpen((v) => !v);
  }

  function toggleDashPopover() {
    setColorPopoverOpen(false);
    setSizePopoverOpen(false);
    setFontSizePopoverOpen(false);
    setDashPopoverOpen((v) => !v);
  }

  function toggleFontSizePopover() {
    setColorPopoverOpen(false);
    setSizePopoverOpen(false);
    setDashPopoverOpen(false);
    setFontSizePopoverOpen((v) => !v);
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
      <div className="draw-stage-frame" ref={stageFrameRef}>
        <div className="draw-stage" style={{ width: stageSize.width, height: stageSize.height }}>
          <div className="draw-backdrop" />
          <canvas ref={canvasRef} className="draw-canvas" />
          <div className="draw-guides">
            {gridVisible && <div className="draw-grid-overlay" />}
            <div className="draw-divider" />
            <span className="draw-tag draw-tag-left">💙</span>
            <span className="draw-tag draw-tag-right">💗</span>
          </div>
          {textEditing && (
            <input
              type="text"
              className="draw-text-input"
              autoFocus
              value={textEditing.value}
              style={{
                left: textEditing.x * stageSize.width,
                top: textEditing.y * stageSize.height,
                fontSize: `${fontSize}px`,
                color: currentColor,
              }}
              onChange={(e) => setTextEditing((t) => (t ? { ...t, value: e.target.value } : t))}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  commitText();
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  cancelText();
                }
              }}
              onBlur={commitText}
            />
          )}
        </div>
      </div>

      <BackButton to="activities" />
      <p className={`draw-status${status.show ? ' show' : ''}`}>{status.text}</p>

      <div className="draw-toolbar-stack">
        <div className="draw-toolbar-row">
          <Tooltip text="Undo last stroke">
            <button type="button" className="draw-tool" onClick={() => socket.emit('draw:undo')}>↩️</button>
          </Tooltip>
          <Tooltip text="Redo">
            <button type="button" className="draw-tool" onClick={() => socket.emit('draw:redo')}>↪️</button>
          </Tooltip>
          <Tooltip text={gridVisible ? 'Hide grid' : 'Show grid'}>
            <button type="button" className={`draw-tool${gridVisible ? ' active' : ''}`} onClick={() => setGridVisible((v) => !v)}>▦</button>
          </Tooltip>
          <Tooltip text="Clear the whole drawing">
            <button type="button" className="draw-tool" onClick={handleClear}>🗑️</button>
          </Tooltip>
          <Tooltip text="Finish & save this drawing">
            <button type="button" className="draw-tool draw-tool-primary" onClick={handleFinish}>✅</button>
          </Tooltip>
        </div>

        <div className="draw-toolbar-row">
          <Tooltip text="Draw">
            <button type="button" className={`draw-tool${activeCategory === 'draw' ? ' active' : ''}`} onClick={selectDrawCategory}>✏️</button>
          </Tooltip>
          <Tooltip text="Shapes">
            <button type="button" className={`draw-tool${activeCategory === 'shapes' ? ' active' : ''}`} onClick={selectShapesCategory}>📐</button>
          </Tooltip>
          <Tooltip text="Text">
            <button type="button" className={`draw-tool${activeCategory === 'text' ? ' active' : ''}`} onClick={selectTextCategory}>🔤</button>
          </Tooltip>
          <Tooltip text="Eraser">
            <button type="button" className={`draw-tool${activeCategory === 'eraser' ? ' active' : ''}`} onClick={selectEraserCategory}>🧹</button>
          </Tooltip>
        </div>

        {activeCategory === 'shapes' && (
          <div className="draw-toolbar-row">
            <Tooltip text="Line">
              <button type="button" className={`draw-tool${activeTool === 'line' ? ' active' : ''}`} onClick={() => selectShapeType('line')}>╱</button>
            </Tooltip>
            <Tooltip text="Rectangle">
              <button type="button" className={`draw-tool${activeTool === 'rect' ? ' active' : ''}`} onClick={() => selectShapeType('rect')}>▭</button>
            </Tooltip>
            <Tooltip text="Ellipse">
              <button type="button" className={`draw-tool${activeTool === 'ellipse' ? ' active' : ''}`} onClick={() => selectShapeType('ellipse')}>◯</button>
            </Tooltip>
            <Tooltip text="Arrow">
              <button type="button" className={`draw-tool${activeTool === 'arrow' ? ' active' : ''}`} onClick={() => selectShapeType('arrow')}>➚</button>
            </Tooltip>
            {(activeTool === 'rect' || activeTool === 'ellipse') && (
              <Tooltip text={filled ? 'Filled shape' : 'Outline only'}>
                <button type="button" className={`draw-fill-toggle${filled ? ' active' : ''}`} onClick={() => setFilled((v) => !v)}>
                  {filled ? 'Filled' : 'Outline'}
                </button>
              </Tooltip>
            )}
          </div>
        )}

        {(activeCategory === 'draw' || activeCategory === 'shapes') && (
          <div className="draw-toolbar-row">
            <Tooltip text="Pencil (hard edge)">
              <button type="button" className={`draw-tool${brushType === 'pencil' ? ' active' : ''}`} onClick={() => setBrushType('pencil')}>✎</button>
            </Tooltip>
            <Tooltip text="Brush (soft edge)">
              <button type="button" className={`draw-tool${brushType === 'brush' ? ' active' : ''}`} onClick={() => setBrushType('brush')}>🖌️</button>
            </Tooltip>
            <Tooltip text="Marker (translucent)">
              <button type="button" className={`draw-tool${brushType === 'marker' ? ' active' : ''}`} onClick={() => setBrushType('marker')}>🖊️</button>
            </Tooltip>
          </div>
        )}

        {(activeCategory === 'draw' || activeCategory === 'shapes') && (
          <div className="draw-toolbar-row">
            <Tooltip text="Primary color">
              <button type="button" className="draw-tool draw-color-preview" style={{ background: currentColor }} onClick={() => openColorPopoverFor('primary')} />
            </Tooltip>
            <Tooltip text={gradientOn ? 'Gradient (on)' : 'Gradient color'}>
              <button type="button" className={`draw-tool${gradientOn ? ' active' : ''}`} onClick={() => setGradientOn((v) => !v)}>🌈</button>
            </Tooltip>
            {gradientOn && (
              <Tooltip text="Secondary color">
                <button type="button" className="draw-tool draw-color-preview" style={{ background: secondColor }} onClick={() => openColorPopoverFor('secondary')} />
              </Tooltip>
            )}
            <Tooltip text="Brush size">
              <button type="button" className="draw-tool" onClick={toggleSizePopover}>📏</button>
            </Tooltip>
            <Tooltip text="Line style">
              <button type="button" className="draw-tool" onClick={toggleDashPopover}>┅</button>
            </Tooltip>
          </div>
        )}

        {activeCategory === 'text' && (
          <div className="draw-toolbar-row">
            <Tooltip text="Text color">
              <button type="button" className="draw-tool draw-color-preview" style={{ background: currentColor }} onClick={() => openColorPopoverFor('primary')} />
            </Tooltip>
            <Tooltip text="Font size">
              <button type="button" className="draw-tool" onClick={toggleFontSizePopover}>🔠</button>
            </Tooltip>
          </div>
        )}

        {activeCategory === 'eraser' && (
          <div className="draw-toolbar-row">
            <Tooltip text="Eraser size">
              <button type="button" className="draw-tool" onClick={toggleSizePopover}>📏</button>
            </Tooltip>
          </div>
        )}

        {colorPopoverOpen && (activeCategory === 'draw' || activeCategory === 'shapes' || activeCategory === 'text') && (
          <div className="draw-popover draw-popover-palette">
            <div className="draw-color-swatches">
              {PALETTE.map((color) => (
                <button
                  type="button"
                  key={color}
                  className={`draw-swatch${color === (colorSlot === 'secondary' ? secondColor : currentColor) ? ' active' : ''}`}
                  style={{ background: color }}
                  onClick={() => selectSwatch(color)}
                />
              ))}
            </div>
            <input
              type="color"
              className="draw-color-custom"
              value={colorSlot === 'secondary' ? secondColor : currentColor}
              onChange={handleCustomColor}
            />
          </div>
        )}

        {sizePopoverOpen && (
          <div className="draw-popover">
            <input type="range" min="2" max="24" value={currentWidth} onChange={(e) => setCurrentWidth(Number(e.target.value))} />
            <span className="draw-size-value">{currentWidth}px</span>
          </div>
        )}

        {fontSizePopoverOpen && (
          <div className="draw-popover">
            <input type="range" min="10" max="72" value={fontSize} onChange={(e) => setFontSize(Number(e.target.value))} />
            <span className="draw-size-value">{fontSize}px</span>
          </div>
        )}

        {dashPopoverOpen && (activeCategory === 'draw' || activeCategory === 'shapes') && (
          <div className="draw-popover">
            {DASH_STYLES.map((d) => (
              <Tooltip text={d} key={d}>
                <button
                  type="button"
                  className={`draw-dash-btn${currentDash === d ? ' active' : ''}`}
                  onClick={() => {
                    setCurrentDash(d);
                    setDashPopoverOpen(false);
                  }}
                >
                  <span className="draw-dash-preview" style={{ borderTopStyle: d }} />
                </button>
              </Tooltip>
            ))}
          </div>
        )}
      </div>

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
