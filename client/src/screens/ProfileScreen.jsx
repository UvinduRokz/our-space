import { useState } from 'react';
import { useApp } from '../context/AppContext.jsx';
import { isSfxMuted, setSfxMuted as persistSfxMuted } from '../lib/sfx.js';
import BackButton from '../components/BackButton.jsx';
import './ProfileScreen.css';

const BEARS = [
  { id: 'good-luck-bear', name: 'Good Luck Bear' },
  { id: 'grumpy-bear', name: 'Grumpy Bear' },
  { id: 'share-bear', name: 'Share Bear' },
  { id: 'tenderheart-bear', name: 'Tenderheart Bear' },
  { id: 'bedtime-bear', name: 'Bedtime Bear' },
  { id: 'cheer-bear', name: 'Cheer Bear' },
  { id: 'funshine-bear', name: 'Funshine Bear' },
];

function previewCursor(bear) {
  document.documentElement.style.setProperty('--cursor-idle', `url('/cursors/${bear}-idle.svg') 8 9, auto`);
  document.documentElement.style.setProperty('--cursor-wave', `url('/cursors/${bear}-hover.svg') 8 9, auto`);
}

export default function ProfileScreen() {
  const { profile, setProfile, apiPost } = useApp();
  const [nickname, setNickname] = useState(profile.partnerNickname || '');
  const [selectedBear, setSelectedBear] = useState(profile.bear || 'tenderheart-bear');
  const [sfxMuted, setSfxMuted] = useState(() => isSfxMuted());
  const [status, setStatus] = useState('');
  const [statusIsError, setStatusIsError] = useState(false);

  function selectBear(bearId) {
    setSelectedBear(bearId);
    previewCursor(bearId); // live preview immediately, independent of hitting Save
  }

  function toggleSfx(checked) {
    setSfxMuted(!checked);
    persistSfxMuted(!checked);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    try {
      const saved = await apiPost('/api/profile', { partnerNickname: nickname, bear: selectedBear });
      setProfile(saved);
      setStatusIsError(false);
      setStatus('saved 💕');
    } catch {
      setStatusIsError(true);
      setStatus("couldn't save, try again");
    }
  }

  return (
    <section className="screen screen--scrollable">
      <BackButton to="main" />
      <h1>Profile</h1>
      <form className="profile-form" onSubmit={handleSubmit}>
        <label htmlFor="profile-nickname">What do you call your partner?</label>
        <input
          id="profile-nickname"
          type="text"
          autoComplete="off"
          maxLength={30}
          placeholder="babe"
          value={nickname}
          onChange={(e) => setNickname(e.target.value)}
        />

        <label className="profile-sfx-label">
          <input type="checkbox" checked={!sfxMuted} onChange={(e) => toggleSfx(e.target.checked)} />
          Sound effects on this device
        </label>

        <label>Pick your cursor bear</label>
        <div className="bear-picker">
          {BEARS.map((b) => (
            <button
              type="button"
              key={b.id}
              className={`bear-option${selectedBear === b.id ? ' active' : ''}`}
              onClick={() => selectBear(b.id)}
            >
              <img src={`/cursors/${b.id}-idle.svg`} alt="" />
              <span className="bear-name">{b.name}</span>
            </button>
          ))}
        </div>

        <button type="submit">Save</button>
        <p className="error" style={statusIsError ? undefined : { color: '#8fffb0' }}>{status}</p>
      </form>
    </section>
  );
}
