import { useState } from 'react';
import { useApp } from '../context/AppContext.jsx';
import './GateScreen.css';

export default function GateScreen() {
  const { login } = useApp();
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await login(name);
    } catch {
      setError("that name isn't recognized");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="screen gate-screen">
      <form className="gate-form" onSubmit={handleSubmit}>
        <h1>Thinking of You</h1>
        <p>What's your name?</p>
        <input
          type="text"
          autoComplete="off"
          autoCapitalize="words"
          placeholder="Your name"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <button type="submit" disabled={submitting}>Enter</button>
        <p className="error">{error}</p>
      </form>
    </section>
  );
}
