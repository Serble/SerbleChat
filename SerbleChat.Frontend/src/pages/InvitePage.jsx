import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { acceptGuildInvite, CLIENT_ID, REDIRECT_URI, OAUTH_URL } from '../api.js';

export default function InvitePage() {
  const { inviteId } = useParams();
  const nav = useNavigate();

  const isLoggedIn = !!localStorage.getItem('jwt');
  const [state, setState]       = useState('idle'); // idle | joining | joined | already | error
  const [guildName, setGuildName] = useState(null);
  const [errMsg, setErrMsg]     = useState(null);

  // Hue based on invite id for a consistent colour splash
  const hue = (Number(inviteId) * 67) % 360;

  async function handleJoin() {
    if (!isLoggedIn) {
      // Store the invite URL so we can redirect back after login
      sessionStorage.setItem('postLoginRedirect', window.location.pathname);
      window.location.href = `${OAUTH_URL}?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code`;
      return;
    }
    setState('joining');
    try {
      const guild = await acceptGuildInvite(inviteId);
      setGuildName(guild.name);
      setState('joined');
      setTimeout(() => nav(`/app/guild/${guild.id}`), 1200);
    } catch (err) {
      if (err.message?.toLowerCase().includes('already a member')) {
        setState('already');
      } else {
        setErrMsg(err.message);
        setState('error');
      }
    }
  }

  // After OAuth callback redirects back here
  useEffect(() => {
    const saved = sessionStorage.getItem('postLoginRedirect');
    if (saved && isLoggedIn) {
      sessionStorage.removeItem('postLoginRedirect');
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div style={{
      minHeight: '100vh', background: '#1e1f22',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: 'system-ui, sans-serif', padding: '1rem',
    }}>
      <div style={{
        background: '#313338', borderRadius: '16px',
        padding: '2.5rem 2rem', width: '100%', maxWidth: 420,
        boxShadow: '0 24px 64px rgba(0,0,0,0.6)',
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1.5rem',
        textAlign: 'center',
      }}>
        {/* Guild icon */}
        <div style={{
          width: 72, height: 72, borderRadius: '30%',
          background: `hsl(${hue},45%,35%)`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: '2rem',
        }}>🏰</div>

        {/* Copy */}
        <div>
          {state === 'joined' ? (
            <>
              <div style={{ fontWeight: 800, fontSize: '1.3rem', color: '#23a55a', marginBottom: '0.4rem' }}>✓ You joined!</div>
              <div style={{ color: '#72767d', fontSize: '0.9rem' }}>Welcome to <strong style={{ color: '#f2f3f5' }}>{guildName}</strong>. Redirecting…</div>
            </>
          ) : state === 'already' ? (
            <>
              <div style={{ fontWeight: 800, fontSize: '1.25rem', color: '#f2f3f5', marginBottom: '0.4rem' }}>Already a member</div>
              <div style={{ color: '#72767d', fontSize: '0.9rem' }}>You're already in this guild.</div>
            </>
          ) : state === 'error' ? (
            <>
              <div style={{ fontWeight: 800, fontSize: '1.25rem', color: '#f23f43', marginBottom: '0.4rem' }}>Invite Error</div>
              <div style={{ color: '#72767d', fontSize: '0.875rem' }}>{errMsg ?? 'This invite may be invalid or expired.'}</div>
            </>
          ) : (
            <>
              <div style={{ fontWeight: 800, fontSize: '1.3rem', color: '#f2f3f5', marginBottom: '0.4rem' }}>You've been invited!</div>
              <div style={{ color: '#72767d', fontSize: '0.9rem' }}>
                {isLoggedIn
                  ? 'Click below to accept the guild invite.'
                  : 'Log in to accept this guild invite.'}
              </div>
            </>
          )}
        </div>

        {/* Action button */}
        {(state === 'idle' || state === 'joining') && (
          <button
            onClick={handleJoin}
            disabled={state === 'joining'}
            style={{
              background: '#7c3aed', border: 'none', borderRadius: '8px',
              padding: '0.75rem 2rem', color: '#fff', fontSize: '1rem',
              fontWeight: 700, cursor: state === 'joining' ? 'default' : 'pointer',
              opacity: state === 'joining' ? 0.7 : 1, transition: 'background 0.15s',
              width: '100%',
            }}
            onMouseEnter={e => { if (state !== 'joining') e.currentTarget.style.background = '#6d28d9'; }}
            onMouseLeave={e => e.currentTarget.style.background = '#7c3aed'}
          >
            {state === 'joining' ? 'Joining…' : isLoggedIn ? 'Accept Invite' : 'Log in to Join'}
          </button>
        )}

        {state === 'already' && (
          <button onClick={() => nav('/app/friends')}
            style={{ background: '#383a40', border: 'none', borderRadius: '8px', padding: '0.75rem 2rem', color: '#f2f3f5', fontSize: '1rem', fontWeight: 700, cursor: 'pointer', width: '100%', transition: 'background 0.15s' }}
            onMouseEnter={e => e.currentTarget.style.background = '#4a4c55'}
            onMouseLeave={e => e.currentTarget.style.background = '#383a40'}>
            Go to App
          </button>
        )}

        {state === 'error' && (
          <button onClick={() => setState('idle')}
            style={{ background: 'transparent', border: '1px solid #3b3d43', borderRadius: '8px', padding: '0.6rem 1.5rem', color: '#72767d', fontSize: '0.9rem', fontWeight: 600, cursor: 'pointer' }}>
            Try again
          </button>
        )}

        {/* Back link */}
        {isLoggedIn && state !== 'joined' && (
          <button onClick={() => nav('/app/friends')}
            style={{ background: 'transparent', border: 'none', color: '#4f5660', fontSize: '0.82rem', cursor: 'pointer', padding: 0 }}
            onMouseEnter={e => e.currentTarget.style.color = '#72767d'}
            onMouseLeave={e => e.currentTarget.style.color = '#4f5660'}>
            Back to app
          </button>
        )}
      </div>
    </div>
  );
}
