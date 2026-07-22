import { useEffect, useState } from 'react';
import { useApp } from '../context/AppContext.jsx';
import BackButton from '../components/BackButton.jsx';
import Modal from '../components/Modal.jsx';
import './GalleryScreen.css';

function formatDate(ts) {
  return new Date(ts).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function GalleryScreen() {
  const { apiGet } = useApp();
  const [drawings, setDrawings] = useState(null);
  const [failed, setFailed] = useState(false);
  const [selected, setSelected] = useState(null);

  useEffect(() => {
    let cancelled = false;
    apiGet('/api/drawings')
      .then((d) => {
        if (!cancelled) setDrawings(d);
      })
      .catch((err) => {
        console.warn('[gallery] failed to load', err);
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <section className="screen screen--scrollable">
      <BackButton to="activities" />
      <h1>Gallery</h1>
      {failed && <p className="gallery-empty">couldn't load the gallery right now</p>}
      {!failed && drawings && drawings.length === 0 && (
        <p className="gallery-empty">no drawings saved yet — go make one 💕</p>
      )}
      {!failed && drawings && drawings.length > 0 && (
        <div className="gallery-grid">
          {drawings.map((d) => (
            <div className="gallery-tile" key={d.id} onClick={() => setSelected(d)}>
              <img src={d.url} alt="a saved drawing" loading="lazy" />
              <span className="gallery-tile-tag">{d.side === 'blue' ? '💙' : '💗'}</span>
              <span className="gallery-tile-date">{formatDate(d.ts)}</span>
            </div>
          ))}
        </div>
      )}

      {selected && (
        <Modal
          onClose={() => setSelected(null)}
          actions={
            <a className="framed-modal-download" href={selected.url} download={`drawing-${selected.id}.png`}>
              Download
            </a>
          }
        >
          <img src={selected.url} alt="a saved drawing" />
        </Modal>
      )}
    </section>
  );
}
