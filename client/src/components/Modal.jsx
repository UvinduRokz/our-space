import './Modal.css';

export default function Modal({ onClose, children, actions }) {
  return (
    <div className="framed-modal">
      <div className="framed-modal-backdrop" onClick={onClose} />
      <div className="framed-modal-frame">{children}</div>
      {actions}
      <button type="button" className="framed-modal-close" onClick={onClose}>
        Close
      </button>
    </div>
  );
}
