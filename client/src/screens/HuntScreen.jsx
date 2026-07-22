import { useEffect, useRef, useState } from 'react';
import { useApp } from '../context/AppContext.jsx';
import BackButton from '../components/BackButton.jsx';
import './HuntScreen.css';

export default function HuntScreen() {
  const { socket, profile, partnerActivity } = useApp();
  const [state, setState] = useState(null);
  const [error, setError] = useState('');
  const [inputValue, setInputValue] = useState('');
  const inputRef = useRef(null);
  const errorTimerRef = useRef(null);
  const partnerHere = partnerActivity === 'hunt';

  useEffect(() => {
    if (!socket) return;
    function onState(newState) {
      // SFX cues (found/complete) are wired up in a later phase alongside
      // the rest of the audio system.
      setState(newState);
      setError('');
    }
    function onInvalid({ reason }) {
      setError(reason || "that word doesn't work");
      clearTimeout(errorTimerRef.current);
      errorTimerRef.current = setTimeout(() => setError(''), 2000);
    }
    socket.on('hunt:state', onState);
    socket.on('hunt:invalid', onInvalid);
    socket.emit('hunt:sync');
    return () => {
      socket.off('hunt:state', onState);
      socket.off('hunt:invalid', onInvalid);
      clearTimeout(errorTimerRef.current);
    };
  }, [socket]);

  useEffect(() => {
    if (!partnerHere && inputRef.current) inputRef.current.blur();
  }, [partnerHere]);

  function handleSubmit(e) {
    e.preventDefault();
    const word = inputValue.trim();
    if (!word) return;
    socket.emit('hunt:submit', { word });
    setInputValue('');
  }

  function statusText() {
    if (!partnerHere) return `waiting for ${profile.partnerNickname} to open this page…`;
    if (!state) return 'connecting…';
    return state.found.length >= state.target ? 'you found 10 together! 🎉' : 'find 10 words together';
  }

  return (
    <section className="screen screen--scrollable">
      <BackButton to="activities" />
      <h1>Letter Hunt</h1>
      <p className="game-status">{statusText()}</p>

      <div className="hunt-letters">
        {state?.letters.map((l, i) => (
          <div className="hunt-letter" key={i}>
            {l}
          </div>
        ))}
      </div>

      <form className="hunt-form" onSubmit={handleSubmit}>
        <input
          ref={inputRef}
          className="game-text-input"
          autoComplete="off"
          autoCapitalize="characters"
          placeholder="type a word"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          disabled={!partnerHere}
        />
        <button type="submit" disabled={!partnerHere}>Add</button>
      </form>
      <p className="error">{error}</p>
      <p className="hunt-progress">{state ? `${state.found.length} / ${state.target} found` : '0 / 10 found'}</p>
      <ul className="hunt-found">
        {state?.found.map((f, i) => (
          <li className={`side-${f.by}`} key={i}>
            {f.word}
          </li>
        ))}
      </ul>
      <button type="button" onClick={() => socket.emit('hunt:new')} disabled={!partnerHere}>
        New Letters
      </button>

      {!partnerHere && (
        <div className="waiting-overlay">
          <p>waiting for {profile.partnerNickname} to open this page before you can play together…</p>
        </div>
      )}
    </section>
  );
}
