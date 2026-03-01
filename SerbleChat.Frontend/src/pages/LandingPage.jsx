import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CLIENT_ID, REDIRECT_URI, OAUTH_URL, exchangeCode } from '../api.js';
import { isElectron, electronOAuthFlow } from '../electron-utils.js';

const c = {
  page: {
    minHeight: '100vh', overflow: 'auto',
    background: 'linear-gradient(135deg, #050e1f 0%, #0a1a35 50%, #05101f 100%)',
    display: 'flex', flexDirection: 'column',
  },
  nav: {
    padding: '1.25rem 2.5rem', display: 'flex', alignItems: 'center', gap: '0.75rem',
    borderBottom: '1px solid rgba(59,130,246,0.08)',
  },
  logoImg: { width: '2.5rem', height: '2.5rem', borderRadius: '8px' },
  logoText: { fontSize: '1.3rem', fontWeight: 800, color: '#3b82f6', margin: 0, letterSpacing: '-0.02em' },
  hero: {
    display: 'flex', flexDirection: 'column',
    alignItems: 'center', justifyContent: 'center',
    padding: '3rem 2rem', textAlign: 'center', minHeight: 'auto',
  },
  badge: {
    display: 'inline-block', background: 'rgba(59,130,246,0.15)',
    border: '1px solid rgba(59,130,246,0.35)', color: '#60a5fa',
    borderRadius: '9999px', padding: '0.3rem 1rem',
    fontSize: '0.75rem', fontWeight: 700, marginBottom: '1.75rem',
    letterSpacing: '0.1em', textTransform: 'uppercase',
  },
  h1: {
    fontSize: 'clamp(2.5rem, 6vw, 4.5rem)', fontWeight: 800,
    color: '#f1f5f9', margin: '0 0 1.25rem', lineHeight: 1.1, letterSpacing: '-0.03em',
  },
  accent: { color: '#60a5fa' },
  sub: {
    fontSize: '1.1rem', color: '#cbd5e1', maxWidth: '480px',
    margin: '0 auto 2rem', lineHeight: 1.65,
  },
  btn: {
    display: 'inline-flex', alignItems: 'center', gap: '0.6rem',
    padding: '0.9rem 2.5rem',
    background: 'linear-gradient(135deg,#3b82f6 0%,#1d4ed8 100%)',
    color: '#fff', borderRadius: '9999px',
    fontWeight: 700, fontSize: '1rem', cursor: 'pointer', border: 'none',
    boxShadow: '0 4px 24px rgba(59,130,246,0.45)',
    transition: 'transform 0.15s, box-shadow 0.15s',
  },
  featureSection: {
    padding: '3rem 2rem', display: 'flex', flexDirection: 'column', alignItems: 'center',
  },
  featureSectionTitle: {
    fontSize: '1.75rem', fontWeight: 800, color: '#e2e8f0', marginBottom: '2.5rem', textAlign: 'center',
  },
  features: {
    display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
    gap: '1.75rem', maxWidth: '1200px', width: '100%', paddingX: '0',
  },
  card: {
    background: 'rgba(30,58,138,0.25)', border: '1px solid rgba(59,130,246,0.2)',
    borderRadius: '16px', padding: '2rem', textAlign: 'left',
    transition: 'border-color 0.3s, background-color 0.3s',
  },
  cardIcon: { fontSize: '2.5rem', marginBottom: '1rem' },
  cardTitle: { fontWeight: 700, color: '#60a5fa', marginBottom: '0.75rem', fontSize: '1.1rem' },
  cardText: { color: '#cbd5e1', fontSize: '0.95rem', lineHeight: 1.6 },
};

export default function LandingPage() {
  const nav = useNavigate();
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [loginError, setLoginError] = useState(null);
  
  useEffect(() => {
    if (localStorage.getItem('jwt')) nav('/app', { replace: true });
  }, [nav]);

  async function login() {
    if (isLoggingIn) return;
    setIsLoggingIn(true);
    setLoginError(null);
    
    const state = Array.from(crypto.getRandomValues(new Uint8Array(16)))
      .map(b => b.toString(16).padStart(2, '0')).join('');
    
    try {
      // Check if running in Electron
      if (isElectron()) {
        // Electron: Use external browser with local callback server
        const electronRedirectUri = 'http://localhost:13579/callback';
        const oauthUrl = `${OAUTH_URL}?${new URLSearchParams({
          client_id: CLIENT_ID, 
          redirect_uri: electronRedirectUri,
          response_type: 'code', 
          scope: 'user_info', 
          state,
        })}`;
        
        // Open browser and wait for callback
        const callbackData = await electronOAuthFlow(oauthUrl);
        
        // Verify state
        if (callbackData.state !== state) {
          throw new Error('State mismatch - possible security issue');
        }
        
        // Check authorization
        if (callbackData.authorized !== 'true' || !callbackData.code) {
          throw new Error('Login was cancelled or denied');
        }
        
        // Exchange code for token
        const data = await exchangeCode(callbackData.code);
        if (!data.success || !data.accessToken) {
          throw new Error('Server did not return an access token');
        }
        
        localStorage.setItem('jwt', data.accessToken);
        nav('/app', { replace: true });
      } else {
        // Web: Use normal redirect flow
        sessionStorage.setItem('oauth_state', state);
        window.location.href = `${OAUTH_URL}?${new URLSearchParams({
          client_id: CLIENT_ID, 
          redirect_uri: REDIRECT_URI,
          response_type: 'code', 
          scope: 'user_info', 
          state,
        })}`;
      }
    } catch (error) {
      console.error('Login error:', error);
      setLoginError(error.message || 'Failed to login. Please try again.');
      setIsLoggingIn(false);
    }
  }

  return (
    <div style={c.page}>
      <nav style={c.nav}>
        <img src="/favicon.webp" alt="Serble Chat" style={c.logoImg} />
        <h1 style={c.logoText}>Serble Chat</h1>
      </nav>

      <section style={c.hero}>
        <img src="/favicon.webp" alt="Serble Chat" style={{ width: '12rem', height: '12rem', marginBottom: '2rem', borderRadius: '27px' }} />
        <p style={c.sub}>
          Real-time messaging, group chats, guilds, friends. All powered by your Serble account.
        </p>
        {loginError && (
          <div style={{
            background: '#7f1d1d',
            color: '#fca5a5',
            padding: '0.75rem 1.25rem',
            borderRadius: '8px',
            marginBottom: '1rem',
            fontSize: '0.9rem',
            maxWidth: '400px',
          }}>
            {loginError}
          </div>
        )}
        <button
          style={{
            ...c.btn,
            opacity: isLoggingIn ? 0.6 : 1,
            cursor: isLoggingIn ? 'not-allowed' : 'pointer',
          }}
          onClick={login}
          disabled={isLoggingIn}
          className="hov-landing-btn"
        >
          {isLoggingIn ? (
            <>⏳ Logging in...</>
          ) : (
            <>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z"/>
              </svg>
              Login with Serble
            </>
          )}
        </button>
      </section>

      <section style={c.featureSection}>
        <h2 style={c.featureSectionTitle}>Why Choose Serble Chat?</h2>
        <div style={c.features}>
          {[
            { 
              icon: '🔐', 
              title: 'Privacy First', 
              text: 'Deleted messages are purged forever. Control your privacy with the option to toggle sending typing indicators.' 
            },
            { 
              icon: '📹', 
              title: 'Voice & Screenshare', 
              text: 'Crystal-clear voice calls and screen sharing. Connect face-to-face with your friends instantly.' 
            },
            { 
              icon: '🔔', 
              title: 'Smart Notifications', 
              text: 'Fine-grained control over notifications. Set preferences per channel and per guild to stay focused.' 
            },
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
