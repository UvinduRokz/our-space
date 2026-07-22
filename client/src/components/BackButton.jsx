import { useApp } from '../context/AppContext.jsx';
import './BackButton.css';

export default function BackButton({ to }) {
  const { navigateTo } = useApp();
  return (
    <button type="button" className="back-btn" onClick={() => navigateTo(to)}>
      ← Back
    </button>
  );
}
