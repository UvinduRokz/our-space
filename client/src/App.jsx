import { useEffect, useState } from 'react'

// Phase 1 vertical slice: prove the Vite dev proxy actually reaches the
// real running Express backend before building any real screens on top of it.
function App() {
  const [config, setConfig] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    fetch('/api/config')
      .then((res) => {
        if (!res.ok) throw new Error(`request failed: ${res.status}`)
        return res.json()
      })
      .then(setConfig)
      .catch((err) => setError(err.message))
  }, [])

  return (
    <div style={{ fontFamily: 'sans-serif', padding: 24 }}>
      <h1>client scaffold: backend connectivity check</h1>
      {error && <p style={{ color: 'red' }}>error: {error}</p>}
      {!error && !config && <p>fetching /api/config through the dev proxy…</p>}
      {config && (
        <pre style={{ background: '#eee', padding: 12 }}>
          {JSON.stringify(config, null, 2)}
        </pre>
      )}
    </div>
  )
}

export default App
