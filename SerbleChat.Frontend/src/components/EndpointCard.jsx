import { useState } from 'react';

const s = {
  card: {
    background: '#1a1d2e', border: '1px solid #2d3148', borderRadius: '10px',
    padding: '1.25rem 1.5rem', marginBottom: '1rem',
  },
  header: {
    display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.75rem',
  },
  method: (m) => {
    const colours = {
      GET: '#166534', POST: '#1e3a5f', PUT: '#713f12', DELETE: '#7f1d1d',
    };
    return {
      background: colours[m] ?? '#374151', color: '#fff', fontWeight: 700,
      fontSize: '0.75rem', padding: '0.2rem 0.6rem', borderRadius: '4px',
      letterSpacing: '0.05em',
    };
  },
  path: { fontFamily: 'monospace', color: '#a78bfa', fontSize: '0.95rem' },
  desc: { color: '#64748b', fontSize: '0.85rem', marginTop: '-0.25rem', marginBottom: '0.75rem' },
  inputRow: { display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.75rem' },
  input: {
    flex: 1, minWidth: '160px', padding: '0.5rem 0.75rem', borderRadius: '6px',
    background: '#0f1117', border: '1px solid #2d3148', color: '#e2e8f0',
    fontSize: '0.9rem', outline: 'none',
  },
  btn: {
    padding: '0.5rem 1.25rem', borderRadius: '6px', background: '#7c3aed',
    color: '#fff', fontWeight: 600, fontSize: '0.9rem', cursor: 'pointer',
    border: 'none', whiteSpace: 'nowrap',
  },
  result: (err) => ({
    background: '#0f1117', borderRadius: '6px', padding: '0.75rem 1rem',
    fontSize: '0.8rem', color: err ? '#fca5a5' : '#94a3b8',
    overflowX: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all',
    maxHeight: '260px', overflowY: 'auto',
  }),
};

export default function EndpointCard({ method, path, description, inputs = [], onCall }) {
  const [values, setValues] = useState({});
  const [result, setResult] = useState(null);
  const [isError, setIsError] = useState(false);
  const [loading, setLoading] = useState(false);

  async function call() {
    setLoading(true);
    setResult(null);
    try {
      const data = await onCall(values);
      setIsError(false);
      setResult(JSON.stringify(data ?? '200 OK', null, 2));
    } catch (e) {
      setIsError(true);
      setResult(e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={s.card}>
      <div style={s.header}>
        <span style={s.method(method)}>{method}</span>
        <span style={s.path}>{path}</span>
      </div>
      <div style={s.desc}>{description}</div>

      {inputs.length > 0 && (
        <div style={s.inputRow}>
          {inputs.map((inp) => (
            <input
              key={inp.name}
              style={s.input}
              placeholder={inp.placeholder ?? inp.name}
              value={values[inp.name] ?? ''}
              onChange={(e) => setValues((v) => ({ ...v, [inp.name]: e.target.value }))}
            />
          ))}
        </div>
      )}

      <button style={s.btn} onClick={call} disabled={loading}>
        {loading ? 'Loading…' : 'Send Request'}
      </button>

      {result !== null && (
        <pre style={{ ...s.result(isError), marginTop: '0.75rem' }}>{result}</pre>
      )}
    </div>
  );
}
