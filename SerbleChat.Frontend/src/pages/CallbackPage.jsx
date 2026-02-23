import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { exchangeCode } from '../api.js';

const s = {
  page: {
    display: 'flex', flexDirection: 'column', alignItems: 'center',
    justifyContent: 'center', minHeight: '100vh', gap: '1.5rem', padding: '2rem',
  },
  card: {
    background: '#1a1d2e', border: '1px solid #2d3148', borderRadius: '12px',
    padding: '2.5rem 3rem', maxWidth: '520px', width: '100%',
    textAlign: 'center', boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
  },
  title: { margin: '0 0 1rem', fontSize: '1.5rem', fontWeight: 700 },
  status: (ok) => ({
    padding: '0.75rem 1rem', borderRadius: '8px', marginBottom: '1rem',
    background: ok ? '#14532d' : '#7f1d1d',
    color: ok ? '#86efac' : '#fca5a5',
    fontSize: '0.9rem',
  }),
  pre: {
    background: '#0f1117', borderRadius: '8px', padding: '1rem',
    textAlign: 'left', fontSize: '0.8rem', color: '#94a3b8',
    overflowX: 'auto', wordBreak: 'break-all', whiteSpace: 'pre-wrap',
  },
  btn: {
    marginTop: '1rem', padding: '0.6rem 1.5rem', borderRadius: '8px',
    background: '#7c3aed', color: '#fff', fontWeight: 600,
    fontSize: '0.9rem', cursor: 'pointer', border: 'none',
  },
};

export default function CallbackPage() {
  const navigate = useNavigate();
  const [status, setStatus] = useState('Processing OAuth callback…');
  const [ok, setOk] = useState(null);
  const [details, setDetails] = useState(null);

  useEffect(() => {
    (async () => {
      const params = new URLSearchParams(window.location.search);
      const authorized = params.get('authorized');
      const code = params.get('code');
      const returnedState = params.get('state');
      const savedState = sessionStorage.getItem('oauth_state');

      // ── CSRF state check ────────────────────────────────────────────────────
      if (returnedState !== savedState) {
        setOk(false);
        setStatus('State mismatch – possible CSRF attack. Login aborted.');
        setDetails({ returnedState, savedState });
        return;
      }
      sessionStorage.removeItem('oauth_state');

      if (authorized !== 'true' || !code) {
        setOk(false);
        setStatus('Serble OAuth denied or no code returned.');
        setDetails({ authorized, code: code ?? '(none)' });
        return;
      }

      setStatus(`Code received. Exchanging with POST /auth…`);
      setDetails({ code });

      try {
        const data = await exchangeCode(code);
        if (!data.success || !data.accessToken) throw new Error('Backend returned success=false');
        localStorage.setItem('jwt', data.accessToken);
        setOk(true);
        setStatus('Authentication successful! Redirecting…');
        setDetails({ accessToken: data.accessToken });
        const redirect = sessionStorage.getItem('postLoginRedirect') ?? '/app';
        sessionStorage.removeItem('postLoginRedirect');
        setTimeout(() => navigate(redirect), 1500);
      } catch (err) {
        setOk(false);
        setStatus(`Token exchange failed: ${err.message}`);
        setDetails({ error: err.message });
      }
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div style={s.page}>
      <div style={s.card}>
        <h2 style={s.title}>OAuth Callback</h2>
        {ok !== null && (
          <div style={s.status(ok)}>{ok ? '✓' : '✗'} {status}</div>
        )}
        {ok === null && <p style={{ color: '#94a3b8' }}>{status}</p>}
        {details && (
          <pre style={s.pre}>{JSON.stringify(details, null, 2)}</pre>
        )}
        {ok === false && (
          <button style={s.btn} onClick={() => navigate('/')}>
            ← Back to Login
          </button>
        )}
      </div>
    </div>
  );
}
