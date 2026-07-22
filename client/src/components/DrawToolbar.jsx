import { useState } from 'react';
import Tooltip from './Tooltip.jsx';
import './DrawToolbar.css';

// A Paint-style 20-swatch palette (two rows of 10) for quick access, instead
// of just a handful of swatches plus a native color picker as the only options.
const PALETTE = [
  '#000000', '#7f7f7f', '#880015', '#ed1c24', '#ff7f27', '#fff200', '#22b14c', '#00a2e8', '#3f48cc', '#a349a4',
  '#ffffff', '#c3c3c3', '#b97a57', '#ffaec9', '#ffc90e', '#efe4b0', '#b5e61d', '#99d9ea', '#7092be', '#c8bfe7',
];

const CATEGORY_OPTIONS = [
  { id: 'draw', icon: '✏️', label: 'Draw' },
  { id: 'shapes', icon: '📐', label: 'Shapes' },
  { id: 'text', icon: '🔤', label: 'Text' },
  { id: 'fill', icon: '🪣', label: 'Fill' },
  { id: 'eraser', icon: '🧹', label: 'Eraser' },
  { id: 'select', icon: '🖱️', label: 'Select' },
];
const SHAPE_OPTIONS = [
  { id: 'line', icon: '╱', label: 'Line' },
  { id: 'rect', icon: '▭', label: 'Rectangle' },
  { id: 'ellipse', icon: '◯', label: 'Ellipse' },
  { id: 'arrow', icon: '➚', label: 'Arrow' },
];
const BRUSH_OPTIONS = [
  { id: 'pencil', icon: '✎', label: 'Pencil' },
  { id: 'brush', icon: '🖌️', label: 'Brush' },
  { id: 'marker', icon: '🖊️', label: 'Marker' },
];
const DASH_OPTIONS = [
  { id: 'solid', label: 'Solid' },
  { id: 'dashed', label: 'Dashed' },
  { id: 'dotted', label: 'Dotted' },
];

// Icon + a real, always-visible text label (icon-over-label on the mobile
// tab bar, icon-beside-label on the desktop rail) — no Tooltip here on
// purpose: it already names itself, so a hover tooltip would just be
// redundant. Tooltip is reserved for the genuinely icon-only buttons
// elsewhere in this toolbar (utilities, color swatches, dash previews…).
function LabeledButton({ icon, label, active, onClick, disabled, variant = 'tool' }) {
  return (
    <button
      type="button"
      className={`draw-labeled-btn draw-labeled-btn--${variant}${active ? ' active' : ''}`}
      onClick={onClick}
      disabled={disabled}
    >
      <span className="draw-labeled-btn-icon">{icon}</span>
      <span className="draw-labeled-btn-text">{label}</span>
    </button>
  );
}

function PanelSection({ label, children }) {
  return (
    <div className="draw-panel-section">
      <span className="draw-panel-label">{label}</span>
      <div className="draw-panel-controls">{children}</div>
    </div>
  );
}

// A color swatch that shows its own palette grid directly beneath it when
// tapped — `slot` distinguishes the primary vs. gradient-secondary color so
// the palette always appears next to whichever swatch is actually being
// edited, rather than always anchoring to one fixed spot.
function ColorSwatch({ slot, color, colorSlot, colorPopoverOpen, openColorPopoverFor, toggleColorPopover, selectSwatch, handleCustomColor }) {
  const isOpenForThis = colorPopoverOpen && colorSlot === slot;
  function handleToggle() {
    if (isOpenForThis) toggleColorPopover();
    else openColorPopoverFor(slot);
  }
  return (
    <>
      <Tooltip text={slot === 'secondary' ? 'Secondary color' : 'Primary color'}>
        <button type="button" className="draw-color-swatch-btn" style={{ background: color }} onClick={handleToggle} />
      </Tooltip>
      {isOpenForThis && (
        <div className="draw-palette">
          <div className="draw-color-swatches">
            {PALETTE.map((c) => (
              <button
                type="button"
                key={c}
                className={`draw-swatch${c === color ? ' active' : ''}`}
                style={{ background: c }}
                onClick={() => selectSwatch(c)}
              />
            ))}
          </div>
          <input type="color" className="draw-color-custom" value={color} onChange={handleCustomColor} />
        </div>
      )}
    </>
  );
}

export default function DrawToolbar({
  activeCategory,
  activeTool,
  currentColor,
  secondColor,
  colorSlot,
  colorPopoverOpen,
  currentWidth,
  currentDash,
  filled,
  brushType,
  gradientOn,
  fontSize,
  selectedId,
  gridVisible,
  selectDrawCategory,
  selectShapesCategory,
  selectShapeType,
  selectEraserCategory,
  selectTextCategory,
  selectSelectCategory,
  selectFillCategory,
  deleteSelected,
  selectSwatch,
  handleCustomColor,
  openColorPopoverFor,
  toggleColorPopover,
  setFilled,
  setGradientOn,
  setBrushType,
  setCurrentDash,
  setCurrentWidth,
  setFontSize,
  setGridVisible,
  onUndo,
  onRedo,
  onClear,
  onReset,
  onFinish,
}) {
  // Collapsed by default (mobile only — see DrawToolbar.css, this has no
  // visual effect at desktop widths where the panel always stays open).
  // Picking a new category opens it; tapping the already-active category
  // again toggles it, so the default view stays compact but options are one
  // tap away.
  const [optionsExpanded, setOptionsExpanded] = useState(false);

  function handleTabClick(category, selectFn) {
    if (category === activeCategory) {
      setOptionsExpanded((v) => !v);
    } else {
      selectFn();
      setOptionsExpanded(true);
    }
  }

  const categorySelectors = {
    draw: selectDrawCategory,
    shapes: selectShapesCategory,
    text: selectTextCategory,
    fill: selectFillCategory,
    eraser: selectEraserCategory,
    select: selectSelectCategory,
  };

  return (
    <div className="draw-toolbar-root">
      <div className="draw-toolbar-utils">
          <Tooltip text="Undo last stroke">
            <button type="button" className="draw-tool" onClick={onUndo}>↩️</button>
          </Tooltip>
          <Tooltip text="Redo">
            <button type="button" className="draw-tool" onClick={onRedo}>↪️</button>
          </Tooltip>
          <Tooltip text={gridVisible ? 'Hide grid' : 'Show grid'}>
            <button type="button" className={`draw-tool${gridVisible ? ' active' : ''}`} onClick={() => setGridVisible((v) => !v)}>▦</button>
          </Tooltip>
          <Tooltip text="Clear your half only">
            <button type="button" className="draw-tool" onClick={onClear}>🗑️</button>
          </Tooltip>
          <Tooltip text="Reset the whole drawing (both sides + canvas shape)">
            <button type="button" className="draw-tool" onClick={onReset}>🔄</button>
          </Tooltip>
          <Tooltip text="Finish & save this drawing">
            <button type="button" className="draw-tool draw-tool-primary" onClick={onFinish}>✅</button>
          </Tooltip>
        </div>

        <div className="draw-tools-group">
          <div className="draw-toolbar-tabs">
            {CATEGORY_OPTIONS.map((cat) => (
              <LabeledButton
                key={cat.id}
                variant="tab"
                icon={cat.icon}
                label={cat.label}
                active={activeCategory === cat.id}
                onClick={() => handleTabClick(cat.id, categorySelectors[cat.id])}
              />
            ))}
          </div>

          <div className={`draw-toolbar-panel${optionsExpanded ? '' : ' collapsed'}`}>
            {activeCategory === 'shapes' && (
              <PanelSection label="Shape">
                {SHAPE_OPTIONS.map((s) => (
                  <LabeledButton
                    key={s.id}
                    icon={s.icon}
                    label={s.label}
                    active={activeTool === s.id}
                    onClick={() => selectShapeType(s.id)}
                  />
                ))}
                {(activeTool === 'rect' || activeTool === 'ellipse') && (
                  <button type="button" className={`draw-fill-toggle${filled ? ' active' : ''}`} onClick={() => setFilled((v) => !v)}>
                    {filled ? 'Filled' : 'Outline'}
                  </button>
                )}
              </PanelSection>
            )}

            {(activeCategory === 'draw' || activeCategory === 'shapes') && (
              <PanelSection label="Brush">
                {BRUSH_OPTIONS.map((b) => (
                  <LabeledButton
                    key={b.id}
                    icon={b.icon}
                    label={b.label}
                    active={brushType === b.id}
                    onClick={() => setBrushType(b.id)}
                  />
                ))}
              </PanelSection>
            )}

            {(activeCategory === 'draw' || activeCategory === 'shapes' || activeCategory === 'text' || activeCategory === 'fill') && (
              <PanelSection label="Color">
                <ColorSwatch
                  slot="primary"
                  color={currentColor}
                  colorSlot={colorSlot}
                  colorPopoverOpen={colorPopoverOpen}
                  openColorPopoverFor={openColorPopoverFor}
                  toggleColorPopover={toggleColorPopover}
                  selectSwatch={selectSwatch}
                  handleCustomColor={handleCustomColor}
                />
              </PanelSection>
            )}

            {(activeCategory === 'draw' || activeCategory === 'shapes') && (
              <PanelSection label="Gradient">
                <Tooltip text={gradientOn ? 'Gradient (on)' : 'Gradient color'}>
                  <button type="button" className={`draw-tool${gradientOn ? ' active' : ''}`} onClick={() => setGradientOn((v) => !v)}>🌈</button>
                </Tooltip>
                {gradientOn && (
                  <ColorSwatch
                    slot="secondary"
                    color={secondColor}
                    colorSlot={colorSlot}
                    colorPopoverOpen={colorPopoverOpen}
                    openColorPopoverFor={openColorPopoverFor}
                    toggleColorPopover={toggleColorPopover}
                    selectSwatch={selectSwatch}
                    handleCustomColor={handleCustomColor}
                  />
                )}
              </PanelSection>
            )}

            {(activeCategory === 'draw' || activeCategory === 'shapes' || activeCategory === 'eraser') && (
              <PanelSection label="Width">
                <input type="range" min="2" max="24" value={currentWidth} onChange={(e) => setCurrentWidth(Number(e.target.value))} />
                <span className="draw-size-value">{currentWidth}px</span>
              </PanelSection>
            )}

            {(activeCategory === 'draw' || activeCategory === 'shapes') && (
              <PanelSection label="Style">
                {DASH_OPTIONS.map((d) => (
                  <Tooltip text={d.label} key={d.id}>
                    <button
                      type="button"
                      className={`draw-dash-btn${currentDash === d.id ? ' active' : ''}`}
                      onClick={() => setCurrentDash(d.id)}
                    >
                      <span className="draw-dash-preview" style={{ borderTopStyle: d.id }} />
                    </button>
                  </Tooltip>
                ))}
              </PanelSection>
            )}

            {activeCategory === 'text' && (
              <PanelSection label="Font size">
                <input type="range" min="10" max="72" value={fontSize} onChange={(e) => setFontSize(Number(e.target.value))} />
                <span className="draw-size-value">{fontSize}px</span>
              </PanelSection>
            )}

            {activeCategory === 'select' && (
              <PanelSection label="Selection">
                <Tooltip text={selectedId ? 'Delete selected object' : 'Tap an object on your half to select it'}>
                  <button type="button" className="draw-tool" disabled={!selectedId} onClick={deleteSelected}>❌</button>
                </Tooltip>
                {!selectedId && <span className="draw-panel-hint">Tap an object on your half to select it</span>}
              </PanelSection>
            )}
          </div>
        </div>
      </div>
  );
}
