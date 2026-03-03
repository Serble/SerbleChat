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
    padding: '1.25rem 2.5rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
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
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <img src="/favicon.webp" alt="Serble Chat" style={c.logoImg} />
          <h1 style={c.logoText}>Serble Chat</h1>
        </div>
        <a
          href="https://github.com/Serble/SerbleChat"
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: 'inline-flex', alignItems: 'center', gap: '0.5rem',
            color: '#94a3b8', fontSize: '0.9rem',
            textDecoration: 'none', transition: 'color 0.2s',
          }}
          onMouseEnter={(e) => e.target.style.color = '#cbd5e1'}
          onMouseLeave={(e) => e.target.style.color = '#94a3b8'}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v 3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
          </svg>
          GitHub
        </a>
      </nav>

      <section style={c.hero}>
        <img src="/favicon.webp" alt="Serble Chat" style={{ width: '12rem', height: '12rem', marginBottom: '2rem', borderRadius: '27px' }} />
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: '0.6rem',
          background: 'rgba(34,197,94,0.15)', border: '1px solid rgba(34,197,94,0.4)',
          color: '#4ade80', borderRadius: '9999px', padding: '0.5rem 1.25rem',
          fontSize: '0.85rem', fontWeight: 700, marginBottom: '1.5rem',
          letterSpacing: '0.05em',
        }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
          </svg>
          No Email Required to Sign Up
        </div>
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
              icon: '⚡', 
              title: 'Instant Access, No Email', 
              text: 'Create your account in seconds without needing an email address. Start chatting immediately.' 
            },
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
            { 
              icon: '💻', 
              title: 'Fully Open Source', 
              text: 'Complete transparency and community-driven development. Inspect the code, contribute, and fork it for your own community.' 
            },
            { 
              icon: '🎨', 
              title: 'Client Theming', 
              text: 'Customize your experience with flexible theming options. Make Serble Chat look and feel exactly how you want it.' 
            },
          ].map(f => (
            <div key={f.title} style={{
              ...c.card,
              ...(f.title === 'Instant Access, No Email' ? {
                background: 'rgba(34,197,94,0.2)',
                border: '2px solid rgba(34,197,94,0.5)',
                boxShadow: '0 0 20px rgba(34,197,94,0.2)',
              } : {}),
            }}>
              <div style={c.cardIcon}>{f.icon}</div>
              <div style={{...c.cardTitle, color: f.title === 'Instant Access, No Email' ? '#4ade80' : '#60a5fa'}}>{f.title}</div>
              <div style={c.cardText}>{f.text}</div>
            </div>
          ))}
        </div>
      </section>

      <section style={{
        padding: '4rem 2rem', display: 'flex', flexDirection: 'column', alignItems: 'center',
        background: 'linear-gradient(135deg, rgba(79,172,254,0.08) 0%, rgba(139,92,246,0.05) 100%)',
        borderTop: '1px solid rgba(59,130,246,0.2)',
        borderBottom: '1px solid rgba(59,130,246,0.2)',
      }}>
        <div style={{
          maxWidth: '700px', textAlign: 'center',
        }}>
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: '0.6rem',
            background: 'rgba(139,92,246,0.2)', border: '1px solid rgba(139,92,246,0.5)',
            color: '#d8b4fe', borderRadius: '9999px', padding: '0.5rem 1.25rem',
            fontSize: '0.85rem', fontWeight: 700, marginBottom: '1.5rem',
            letterSpacing: '0.05em',
          }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v 3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
            </svg>
            Open Source & Community-Driven
          </div>
          <h2 style={{
            fontSize: '2rem', fontWeight: 800, color: '#f1f5f9', margin: '0 0 1rem', lineHeight: 1.2,
            letterSpacing: '-0.02em',
          }}>
            Built in the <span style={{ color: '#d8b4fe' }}>Open</span>
          </h2>
          <p style={{
            fontSize: '1rem', color: '#cbd5e1', margin: '0 0 2rem', lineHeight: 1.7,
          }}>
            Serble Chat is completely open source. Inspect the code, contribute features, report issues, or fork it for your own community. 
            We believe in transparency and the power of collaborative development. Your privacy and security matter—and you can verify it yourself.
          </p>
          <a
            href="https://github.com/Serble/SerbleChat"
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: 'inline-flex', alignItems: 'center', gap: '0.6rem',
              padding: '0.85rem 2.25rem',
              background: 'rgba(139,92,246,0.3)', border: '2px solid rgba(139,92,246,0.6)',
              color: '#d8b4fe', borderRadius: '9999px',
              fontWeight: 700, fontSize: '1rem', cursor: 'pointer',
              textDecoration: 'none',
              transition: 'all 0.2s',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(139,92,246,0.5)';
              e.currentTarget.style.boxShadow = '0 0 20px rgba(139,92,246,0.4)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'rgba(139,92,246,0.3)';
              e.currentTarget.style.boxShadow = 'none';
            }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v 3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
            </svg>
            Explore on GitHub
          </a>
        </div>
      </section>
    </div>
  );
}
