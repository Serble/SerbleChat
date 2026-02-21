import { useNavigate } from 'react-router-dom';
import { CLIENT_ID, REDIRECT_URI, OAUTH_URL } from '../api.js';

const s = {
  page: {
    display: 'flex', flexDirection: 'column', alignItems: 'center',
    justifyContent: 'center', minHeight: '100vh', gap: '2rem',
    padding: '2rem',
  },
  card: {
    background: '#1a1d2e', border: '1px solid #2d3148', borderRadius: '12px',
    padding: '2.5rem 3rem', maxWidth: '480px', width: '100%',
    textAlign: 'center', boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
  },
  title: { margin: 0, fontSize: '2rem', fontWeight: 700, color: '#a78bfa' },
  sub: { margin: '0.5rem 0 2rem', color: '#94a3b8', fontSize: '0.95rem' },
  btn: {
    display: 'inline-block', padding: '0.75rem 2rem', borderRadius: '8px',
    background: 'linear-gradient(135deg,#7c3aed,#4f46e5)', color: '#fff',
    fontWeight: 600, fontSize: '1rem', cursor: 'pointer', border: 'none',
    textDecoration: 'none', transition: 'opacity 0.2s',
  },
  flow: {
    background: '#0f1117', borderRadius: '8px', padding: '1rem 1.25rem',
    textAlign: 'left', fontSize: '0.82rem', color: '#94a3b8', lineHeight: 1.7,
  },
  step: { fontWeight: 600, color: '#a78bfa' },
};

export default function LoginPage() {
  const navigate = useNavigate();

  // If already logged in go straight to dashboard
  if (localStorage.getItem('jwt')) {
    navigate('/dashboard');
    return null;
  }

  function handleLogin() {
    // Generate and persist a random CSRF state token
    const state = Array.from(crypto.getRandomValues(new Uint8Array(16)))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    sessionStorage.setItem('oauth_state', state);

    const params = new URLSearchParams({
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      response_type: 'token',
      scope: 'user_info',
      state,
    });

    window.location.href = `${OAUTH_URL}?${params}`;
  }

  return (
    <div style={s.page}>
      <div style={s.card}>
        <h1 style={s.title}>SerbleChat</h1>
        <p style={s.sub}>Sign in with your Serble account to continue</p>

        <button style={s.btn} onClick={handleLogin}>
          Login with Serble
        </button>

        <div style={{ marginTop: '2rem' }}>
          <div style={s.flow}>
            <div><span style={s.step}>Step 1</span> – You are redirected to Serble OAuth</div>
            <div><span style={s.step}>Step 2</span> – Serble sends you back to <code>/callback</code> with a <code>code</code></div>
            <div><span style={s.step}>Step 3</span> – The code is exchanged with <code>POST /auth</code> for a JWT</div>
            <div><span style={s.step}>Step 4</span> – The JWT is stored and you reach the dashboard</div>
          </div>
          <div style={{ marginTop: '0.75rem', fontSize: '0.78rem', color: '#4a5568' }}>
            OAuth URL: <code style={{ color: '#7c3aed' }}>{OAUTH_URL}</code><br />
            redirect_uri: <code style={{ color: '#7c3aed' }}>{REDIRECT_URI}</code>
          </div>
        </div>
      </div>
    </div>
  );
}
