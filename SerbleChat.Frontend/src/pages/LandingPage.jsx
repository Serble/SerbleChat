import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { CLIENT_ID, REDIRECT_URI, OAUTH_URL } from '../api.js';

const c = {
  page: {
    minHeight: '100vh', overflow: 'auto',
    background: 'linear-gradient(145deg, #0d0f15 0%, #1a1035 60%, #0d1520 100%)',
    display: 'flex', flexDirection: 'column',
  },
  nav: {
    padding: '1.25rem 2.5rem', display: 'flex', alignItems: 'center',
    borderBottom: '1px solid rgba(255,255,255,0.05)',
  },
  logo: { fontSize: '1.3rem', fontWeight: 800, color: '#a78bfa', margin: 0, letterSpacing: '-0.02em' },
  hero: {
    flex: 1, display: 'flex', flexDirection: 'column',
    alignItems: 'center', justifyContent: 'center',
    padding: '5rem 2rem 4rem', textAlign: 'center',
  },
  badge: {
    display: 'inline-block', background: 'rgba(124,58,237,0.15)',
    border: '1px solid rgba(124,58,237,0.35)', color: '#a78bfa',
    borderRadius: '9999px', padding: '0.3rem 1rem',
    fontSize: '0.75rem', fontWeight: 700, marginBottom: '1.75rem',
    letterSpacing: '0.1em', textTransform: 'uppercase',
  },
  h1: {
    fontSize: 'clamp(2.5rem, 6vw, 4.5rem)', fontWeight: 800,
    color: '#f1f5f9', margin: '0 0 1.25rem', lineHeight: 1.1, letterSpacing: '-0.03em',
  },
  accent: { color: '#a78bfa' },
  sub: {
    fontSize: '1.1rem', color: '#94a3b8', maxWidth: '480px',
    margin: '0 auto 2.75rem', lineHeight: 1.65,
  },
  btn: {
    display: 'inline-flex', alignItems: 'center', gap: '0.6rem',
    padding: '0.9rem 2.5rem',
    background: 'linear-gradient(135deg,#7c3aed 0%,#5b21b6 100%)',
    color: '#fff', borderRadius: '9999px',
    fontWeight: 700, fontSize: '1rem', cursor: 'pointer', border: 'none',
    boxShadow: '0 4px 24px rgba(124,58,237,0.45)',
    transition: 'transform 0.15s, box-shadow 0.15s',
  },
  features: {
    display: 'flex', gap: '1.25rem', flexWrap: 'wrap',
    justifyContent: 'center', marginTop: '4rem', padding: '0 2rem',
    maxWidth: 900, margin: '4rem auto 0',
  },
  card: {
    background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: '12px', padding: '1.5rem', flex: '1', minWidth: 200, maxWidth: 260,
    textAlign: 'left',
  },
  cardIcon: { fontSize: '1.75rem', marginBottom: '0.75rem' },
  cardTitle: { fontWeight: 700, color: '#e2e8f0', marginBottom: '0.4rem', fontSize: '0.95rem' },
  cardText: { color: '#64748b', fontSize: '0.85rem', lineHeight: 1.55 },
};

export default function LandingPage() {
  const nav = useNavigate();
  useEffect(() => {
    if (localStorage.getItem('jwt')) nav('/app', { replace: true });
  }, [nav]);

  function login() {
    const state = Array.from(crypto.getRandomValues(new Uint8Array(16)))
      .map(b => b.toString(16).padStart(2, '0')).join('');
    sessionStorage.setItem('oauth_state', state);
    window.location.href = `${OAUTH_URL}?${new URLSearchParams({
      client_id: CLIENT_ID, redirect_uri: REDIRECT_URI,
      response_type: 'token', scope: 'user_info', state,
    })}`;
  }

  return (
    <div style={c.page}>
      <nav style={c.nav}>
        <h1 style={c.logo}>SerbleChat</h1>
      </nav>

      <section style={c.hero}>
        <div style={c.badge}>✦ Open Beta</div>
        <h1 style={c.h1}>
          Chat with your<br /><span style={c.accent}>friends</span>
        </h1>
        <p style={c.sub}>
          Real-time messaging, group chats and friend requests — all powered by your Serble account.
        </p>
        <button
          style={c.btn}
          onClick={login}
          onMouseEnter={e => {
            e.currentTarget.style.transform = 'translateY(-2px)';
            e.currentTarget.style.boxShadow = '0 10px 36px rgba(124,58,237,0.6)';
          }}
          onMouseLeave={e => {
            e.currentTarget.style.transform = '';
            e.currentTarget.style.boxShadow = '0 4px 24px rgba(124,58,237,0.45)';
          }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z"/>
          </svg>
          Login with Serble
        </button>

        <div style={c.features}>
          {[
            { icon: '💬', title: 'Direct Messages', text: 'Private one-on-one conversations with your friends.' },
            { icon: '👥', title: 'Group Chats',     text: 'Create group chats and bring your friend circle together.' },
            { icon: '⚡', title: 'Real-time',       text: 'Instant message delivery powered by SignalR.' },
          ].map(f => (
            <div key={f.title} style={c.card}>
              <div style={c.cardIcon}>{f.icon}</div>
              <div style={c.cardTitle}>{f.title}</div>
              <div style={c.cardText}>{f.text}</div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
