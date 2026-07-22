import { useEffect, useRef, useState } from 'react';
import { useApp } from '../context/AppContext.jsx';
import BackButton from '../components/BackButton.jsx';
import './WordleScreen.css';

export default function WordleScreen() {
  const { socket, side, profile, partnerActivity } = useApp();
  const [state, setState] = useState(null);
  const [remoteTyping, setRemoteTyping] = useState('');
  const [inputValue, setInputValue] = useState('');
  const inputRef = useRef(null);
  const partnerHere = partnerActivity === 'wordle';

  useEffect(() => {
    if (!socket) return;
    function onState(newState) {
      // SFX cues (submit/win/lose) are wired up in a later phase alongside
      // the rest of the audio system — diffing prevState vs newState here
      // is where that would hook in.
      setState(newState);
      setRemoteTyping('');
      setInputValue('');
    }
    function onTyping({ text }) {
      setRemoteTyping(text || '');
    }
    socket.on('wordle:state', onState);
    socket.on('wordle:typing', onTyping);
    socket.emit('wordle:sync');
    return () => {
      socket.off('wordle:state', onState);
      socket.off('wordle:typing', onTyping);
    };
  }, [socket]);

  useEffect(() => {
    if (!partnerHere && inputRef.current) inputRef.current.blur();
  }, [partnerHere]);

  const isMyTurn = state && state.status === 'playing' && state.turn === side;
  const disabled = !partnerHere || !state || state.status !== 'playing' || state.turn !== side;

  function handleInput(e) {
    const clean = e.target.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 5);
    setInputValue(clean);
    socket.volatile.emit('wordle:type', { text: clean });
  }

  function handleKeyDown(e) {
    if (e.key !== 'Enter') return;
    const word = inputValue.trim();
    if (word.length !== 5) return;
    socket.emit('wordle:guess', { word });
  }

  function statusText() {
    if (!partnerHere) return `waiting for ${profile.partnerNickname} to open this page…`;
    if (!state) return 'connecting…';
    if (state.status === 'won') return `you got it! the word was ${state.target.toUpperCase()} 🎉`;
    if (state.status === 'lost') return `out of guesses — it was ${state.target.toUpperCase()}`;
    return isMyTurn ? 'your turn — type a guess' : `${profile.partnerNickname}'s turn — watch them type…`;
  }

  const maxGuesses = (state && state.maxGuesses) || 6;
  const guesses = (state && state.guesses) || [];
  const activeRowIndex = guesses.length;
  const activeText = state && state.status === 'playing' ? (isMyTurn ? inputValue : remoteTyping) : '';

  const tiles = [];
  for (let row = 0; row < maxGuesses; row++) {
    for (let col = 0; col < 5; col++) {
      let char = '';
      let cls = 'wordle-tile';
      if (row < guesses.length) {
        const g = guesses[row];
        char = g.word[col];
        cls += ` ${g.result[col]}`;
      } else if (row === activeRowIndex && activeText[col]) {
        char = activeText[col];
        cls += ' typing';
      }
      tiles.push(
        <div className={cls} key={`${row}-${col}`}>
          {char}
        </div>
      );
    }
  }

  return (
    <section className="screen screen--scrollable">
      <BackButton to="activities" />
      <h1>Wordle Together</h1>
      <p className="game-status">{statusText()}</p>
      <div className="wordle-grid">{tiles}</div>
      <input
        ref={inputRef}
        className="game-text-input"
        autoComplete="off"
        autoCapitalize="characters"
        maxLength={5}
        placeholder="type your guess"
        value={inputValue}
        onChange={handleInput}
        onKeyDown={handleKeyDown}
        disabled={disabled}
      />
      {state && state.status !== 'playing' && (
        <button type="button" onClick={() => socket.emit('wordle:new')}>
          Play Again
        </button>
      )}

      {!partnerHere && (
        <div className="waiting-overlay">
          <p>waiting for {profile.partnerNickname} to open this page before you can play together…</p>
        </div>
      )}
    </section>
  );
}
