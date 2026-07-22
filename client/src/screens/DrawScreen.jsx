import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useApp } from '../context/AppContext.jsx';
import BackButton from '../components/BackButton.jsx';
import Modal from '../components/Modal.jsx';
import DrawToolbar from '../components/DrawToolbar.jsx';
import './DrawScreen.css';

const SHAPE_TOOL_TYPES = ['line', 'rect', 'ellipse', 'arrow'];

function distToSegment(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

// Fixed on purpose: the canvas used to just stretch to fill whichever
// device's screen it was on, so the same fractional stroke coordinates
// drew a different shape (circle vs. ellipse) for each partner. Locking
// both sides to one shared ratio and letterboxing it (see computeStageSize
// below) keeps strokes shaped the same everywhere, no matter the device.
// Which ratio is server-authoritative (see draw:set-aspect-ratio) — whoever
// picks first locks it for both sides until the next draw:clear.
const ASPECT_PRESETS = [
  { id: 'portrait', ratio: 9 / 16, label: 'Portrait' },
  { id: 'square', ratio: 1, label: 'Square' },
  { id: 'landscape', ratio: 16 / 9, label: 'Landscape' },
];

export default function DrawScreen() {
  const { socket, side, profile, apiPost, partnerActivity } = useApp();
  const partnerHere = partnerActivity === 'draw';

  const stageFrameRef = useRef(null);
  const canvasRef = useRef(null);
  const ctxRef = useRef(null);
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 });
  // null = not chosen yet for this drawing — shows the picker instead of
  // the canvas. Server-authoritative (draw:aspect-ratio), so whichever side
  // picks first is what both of you see, and it resets on draw:clear.
  const [aspectRatio, setAspectRatio] = useState(null);
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
    selectedId: null, // authoritative selection for the Select tool (mirrored into React state for UI only)
    dragStartPoint: null, // fractional {x,y} where a select-tool drag began
    dragOrigPoints: null, // the selected object's points at drag start, so deltas don't compound across pointermove events
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
  const [fontSize, setFontSize] = useState(24);
  const [textEditing, setTextEditing] = useState(null); // { x, y (fractional canvas point), value } while placing a text object
  const [selectedId, setSelectedId] = useState(null); // mirrors engineRef.current.selectedId, for UI only (delete button, keyboard shortcut)
  const [gridVisible, setGridVisible] = useState(false);
  const [status, setStatus] = useState({ text: '', show: false });
  const [reveal, setReveal] = useState(null); // saved drawing url, or null
  const statusTimerRef = useRef(null);

  const activeCategory =
    activeTool === 'eraser' ? 'eraser' :
    activeTool === 'text' ? 'text' :
    activeTool === 'select' ? 'select' :
    SHAPE_TOOL_TYPES.includes(activeTool) ? 'shapes' : 'draw';

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

  // Bounding box in pixel space, for both the Select tool's highlight
  // outline and (for rect/ellipse/text) its hit-testing.
  function getObjectBounds(obj, rect) {
    const toPx = (p) => ({ x: p.x * rect.width, y: p.y * rect.height });
    if (!obj.type || obj.type === 'freehand') {
      const pts = (obj.points || []).map(toPx);
      if (!pts.length) return null;
      const xs = pts.map((p) => p.x);
      const ys = pts.map((p) => p.y);
      const pad = (obj.width || 4) / 2 + 4;
      return { x: Math.min(...xs) - pad, y: Math.min(...ys) - pad, w: Math.max(...xs) - Math.min(...xs) + pad * 2, h: Math.max(...ys) - Math.min(...ys) + pad * 2 };
    }
    if (obj.type === 'text') {
      const ctx = ctxRef.current;
      ctx.font = `${obj.fontSize || 24}px sans-serif`;
      const width = ctx.measureText(obj.text || '').width;
      const height = obj.fontSize || 24;
      const p = toPx(obj.points[0]);
      return { x: p.x - 3, y: p.y - 3, w: width + 6, h: height + 6 };
    }
    const [p1, p2] = obj.points;
    const a = toPx(p1);
    const b = toPx(p2 || p1);
    const pad = (obj.width || 4) / 2 + 6;
    return { x: Math.min(a.x, b.x) - pad, y: Math.min(a.y, b.y) - pad, w: Math.abs(b.x - a.x) + pad * 2, h: Math.abs(b.y - a.y) + pad * 2 };
  }

  // Point-precise hit-testing for the Select tool — thin/diagonal shapes
  // (freehand/line/arrow) use distance-to-segment so clicking far from the
  // actual line inside its bounding box doesn't count; filled-ish shapes
  // (rect/ellipse/text) just check "inside," which matches how people
  // expect to click those.
  function hitTestObject(pxPoint, obj, rect) {
    const toPx = (p) => ({ x: p.x * rect.width, y: p.y * rect.height });
    const tolerance = Math.max(10, (obj.width || 4) / 2 + 6);
    if (!obj.type || obj.type === 'freehand') {
      const pts = obj.points || [];
      for (let i = 1; i < pts.length; i++) {
        if (distToSegment(pxPoint, toPx(pts[i - 1]), toPx(pts[i])) <= tolerance) return true;
      }
      return pts.length === 1 && Math.hypot(pxPoint.x - toPx(pts[0]).x, pxPoint.y - toPx(pts[0]).y) <= tolerance;
    }
    if (obj.type === 'line' || obj.type === 'arrow') {
      const [p1, p2] = obj.points;
      return distToSegment(pxPoint, toPx(p1), toPx(p2)) <= tolerance;
    }
    if (obj.type === 'rect') {
      const [p1, p2] = obj.points;
      const a = toPx(p1);
      const b = toPx(p2);
      const x = Math.min(a.x, b.x);
      const y = Math.min(a.y, b.y);
      const w = Math.abs(b.x - a.x);
      const h = Math.abs(b.y - a.y);
      return pxPoint.x >= x - tolerance && pxPoint.x <= x + w + tolerance && pxPoint.y >= y - tolerance && pxPoint.y <= y + h + tolerance;
    }
    if (obj.type === 'ellipse') {
      const [p1, p2] = obj.points;
      const a = toPx(p1);
      const b = toPx(p2);
      const cx = (a.x + b.x) / 2;
      const cy = (a.y + b.y) / 2;
      const rx = Math.abs(b.x - a.x) / 2 + tolerance;
      const ry = Math.abs(b.y - a.y) / 2 + tolerance;
      if (rx <= 0 || ry <= 0) return false;
      const nx = (pxPoint.x - cx) / rx;
      const ny = (pxPoint.y - cy) / ry;
      return nx * nx + ny * ny <= 1;
    }
    if (obj.type === 'text') {
      const bounds = getObjectBounds(obj, rect);
      if (!bounds) return false;
      return (
        pxPoint.x >= bounds.x - tolerance && pxPoint.x <= bounds.x + bounds.w + tolerance &&
        pxPoint.y >= bounds.y - tolerance && pxPoint.y <= bounds.y + bounds.h + tolerance
      );
    }
    return false;
  }

  function drawSelectionHighlight(obj, rect) {
    const ctx = ctxRef.current;
    const bounds = getObjectBounds(obj, rect);
    if (!bounds) return;
    ctx.save();
    ctx.strokeStyle = '#4f8fff';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.strokeRect(bounds.x, bounds.y, bounds.w, bounds.h);
    ctx.restore();
  }

  function redrawAll() {
    const canvas = canvasRef.current;
    const ctx = ctxRef.current;
    const rect = canvas.getBoundingClientRect();
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
    const selId = engineRef.current.selectedId;
    if (selId) {
      const obj = engineRef.current.strokes[side].find((o) => o.id === selId);
      if (obj) drawSelectionHighlight(obj, rect);
    }
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

  // Largest box matching aspectRatio that still fits inside the available
  // screen space — the letterboxing/pillarboxing that keeps the canvas's
  // shape identical on both partners' devices regardless of their own
  // screen's aspect ratio. No-op until a ratio has actually been chosen.
  function computeStageSize() {
    const frame = stageFrameRef.current;
    if (!frame || !aspectRatio) return;
    const availW = frame.clientWidth;
    const availH = frame.clientHeight;
    let width = availW;
    let height = width / aspectRatio;
    if (height > availH) {
      height = availH;
      width = height * aspectRatio;
    }
    setStageSize({ width, height });
  }

  useEffect(() => {
    computeStageSize();
    window.addEventListener('resize', computeStageSize);
    return () => window.removeEventListener('resize', computeStageSize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aspectRatio]);

  useEffect(() => {
    function onKeyDown(e) {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      if (activeTool !== 'select' || !selectedId) return;
      // don't steal Backspace from an actual text field elsewhere on the page
      if (document.activeElement && document.activeElement.tagName === 'INPUT') return;
      e.preventDefault();
      deleteSelected();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTool, selectedId]);

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

      if (tool === 'select') {
        const rect = canvas.getBoundingClientRect();
        const pxPoint = { x: cp.x * rect.width, y: cp.y * rect.height };
        const list = eng.strokes[side];
        let hitObj = null;
        for (let i = list.length - 1; i >= 0; i--) {
          if (hitTestObject(pxPoint, list[i], rect)) {
            hitObj = list[i];
            break;
          }
        }
        if (hitObj) {
          canvas.setPointerCapture(e.pointerId);
          eng.selectedId = hitObj.id;
          eng.dragStartPoint = cp;
          eng.dragOrigPoints = hitObj.points.map((pt) => ({ ...pt }));
        } else {
          eng.selectedId = null;
          eng.dragStartPoint = null;
          eng.dragOrigPoints = null;
        }
        setSelectedId(eng.selectedId);
        redrawAll();
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
      } else if (tool === 'select') {
        if (!eng.selectedId || !eng.dragStartPoint) return;
        const p = clampFrac(toFrac(e.clientX, e.clientY));
        const dx = p.x - eng.dragStartPoint.x;
        const dy = p.y - eng.dragStartPoint.y;
        const obj = eng.strokes[side].find((o) => o.id === eng.selectedId);
        if (!obj) return;
        obj.points = eng.dragOrigPoints.map((pt) => clampFrac({ x: pt.x + dx, y: pt.y + dy }));
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
      } else if (tool === 'select') {
        if (!eng.selectedId || !eng.dragStartPoint) return;
        eng.dragStartPoint = null;
        eng.dragOrigPoints = null;
        const obj = eng.strokes[side].find((o) => o.id === eng.selectedId);
        if (!obj) return;
        socket.emit('draw:object-move', { id: obj.id, points: obj.points });
      }
    }

    function onRemoteState(state) {
      eng.strokes = { blue: state.blue || [], pink: state.pink || [] };
      clearStaleSelection();
      redrawAll();
    }
    function onAspectRatio({ ratio }) {
      setAspectRatio(ratio);
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
    function onObjectMove({ side: fromSide, id, points }) {
      if (fromSide === side) return; // our own, already applied locally in onPointerUp
      const obj = eng.strokes[fromSide].find((o) => o.id === id);
      if (!obj) return;
      obj.points = points;
      redrawAll();
    }
    function onObjectDelete({ side: fromSide, id }) {
      if (fromSide === side) return;
      const list = eng.strokes[fromSide];
      const idx = list.findIndex((o) => o.id === id);
      if (idx !== -1) list.splice(idx, 1);
      redrawAll();
    }
    function onUndo({ side: fromSide }) {
      if (!eng.strokes[fromSide].length) return;
      eng.strokes[fromSide].pop();
      clearStaleSelection();
      redrawAll();
    }
    function onRedo({ side: fromSide, stroke }) {
      eng.strokes[fromSide].push(stroke);
      redrawAll();
    }
    function onCleared() {
      eng.strokes = { blue: [], pink: [] };
      clearStaleSelection();
      redrawAll();
    }
    function clearStaleSelection() {
      if (eng.selectedId && !eng.strokes[side].some((o) => o.id === eng.selectedId)) {
        eng.selectedId = null;
        eng.dragStartPoint = null;
        eng.dragOrigPoints = null;
        setSelectedId(null);
      }
    }

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerUp);

    socket.on('draw:state', onRemoteState);
    socket.on('draw:stroke-start', onRemoteStart);
    socket.on('draw:stroke-points', onRemotePoints);
    socket.on('draw:shape-commit', onShapeCommit);
    socket.on('draw:object-move', onObjectMove);
    socket.on('draw:object-delete', onObjectDelete);
    socket.on('draw:undo', onUndo);
    socket.on('draw:redo', onRedo);
    socket.on('draw:cleared', onCleared);
    socket.on('draw:aspect-ratio', onAspectRatio);

    socket.emit('draw:sync');

    return () => {
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerUp);
      socket.off('draw:state', onRemoteState);
      socket.off('draw:aspect-ratio', onAspectRatio);
      socket.off('draw:stroke-start', onRemoteStart);
      socket.off('draw:stroke-points', onRemotePoints);
      socket.off('draw:shape-commit', onShapeCommit);
      socket.off('draw:object-move', onObjectMove);
      socket.off('draw:object-delete', onObjectDelete);
      socket.off('draw:undo', onUndo);
      socket.off('draw:redo', onRedo);
      socket.off('draw:cleared', onCleared);
      eng.isDrawing = false;
      eng.lastLocalPoint = null;
      eng.shapeStart = null;
      eng.shapePreview = null;
      eng.dragStartPoint = null;
      eng.dragOrigPoints = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socket, side]);

  function switchTool(tool) {
    setActiveTool(tool);
    setColorPopoverOpen(false);
    commitText();
    engineRef.current.selectedId = null;
    engineRef.current.dragStartPoint = null;
    engineRef.current.dragOrigPoints = null;
    setSelectedId(null);
    redrawAll();
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
  function selectSelectCategory() {
    switchTool('select');
  }

  function deleteSelected() {
    const id = engineRef.current.selectedId;
    if (!id) return;
    const list = engineRef.current.strokes[side];
    const idx = list.findIndex((o) => o.id === id);
    if (idx !== -1) list.splice(idx, 1);
    engineRef.current.selectedId = null;
    setSelectedId(null);
    socket.emit('draw:object-delete', { id });
    redrawAll();
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
    setColorPopoverOpen(true);
  }

  function toggleColorPopover() {
    setColorPopoverOpen((v) => !v);
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

      {aspectRatio && (
        <DrawToolbar
          activeCategory={activeCategory}
          activeTool={activeTool}
          currentColor={currentColor}
          secondColor={secondColor}
          colorSlot={colorSlot}
          colorPopoverOpen={colorPopoverOpen}
          currentWidth={currentWidth}
          currentDash={currentDash}
          filled={filled}
          brushType={brushType}
          gradientOn={gradientOn}
          fontSize={fontSize}
          selectedId={selectedId}
          gridVisible={gridVisible}
          selectDrawCategory={selectDrawCategory}
          selectShapesCategory={selectShapesCategory}
          selectShapeType={selectShapeType}
          selectEraserCategory={selectEraserCategory}
          selectTextCategory={selectTextCategory}
          selectSelectCategory={selectSelectCategory}
          deleteSelected={deleteSelected}
          selectSwatch={selectSwatch}
          handleCustomColor={handleCustomColor}
          openColorPopoverFor={openColorPopoverFor}
          toggleColorPopover={toggleColorPopover}
          setFilled={setFilled}
          setGradientOn={setGradientOn}
          setBrushType={setBrushType}
          setCurrentDash={setCurrentDash}
          setCurrentWidth={setCurrentWidth}
          setFontSize={setFontSize}
          setGridVisible={setGridVisible}
          onUndo={() => socket.emit('draw:undo')}
          onRedo={() => socket.emit('draw:redo')}
          onClear={handleClear}
          onFinish={handleFinish}
        />
      )}

      {!aspectRatio && (
        <div className="draw-aspect-overlay">
          <div className="draw-aspect-picker">
            <h2>Choose a canvas shape</h2>
            <p>Whoever picks first sets it for both of you — it stays fixed until you clear the drawing.</p>
            <div className="draw-aspect-options">
              {ASPECT_PRESETS.map((p) => (
                <button
                  type="button"
                  key={p.id}
                  className="draw-aspect-option"
                  onClick={() => socket.emit('draw:set-aspect-ratio', { preset: p.id })}
                >
                  <span className="draw-aspect-preview" style={{ width: `${70 * p.ratio}px`, height: '70px' }} />
                  <span>{p.label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {!partnerHere && aspectRatio && (
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
