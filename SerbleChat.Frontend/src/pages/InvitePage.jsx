import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { acceptGuildInvite, getGuildInvite, getGuildIconUrl, CLIENT_ID, REDIRECT_URI, OAUTH_URL, exchangeCode } from '../api.js';
import { isElectron, electronOAuthFlow } from '../electron-utils.js';

export default function InvitePage() {
  const { inviteId } = useParams();
  const nav = useNavigate();

  const isLoggedIn = !!localStorage.getItem('jwt');
  const [state, setState]       = useState('idle'); // idle | joining | joined | already | error
  const [guildName, setGuildName] = useState(null);
  const [guildInfo, setGuildInfo] = useState(null); // Store full guild info from invite
  const [loadingInvite, setLoadingInvite] = useState(true); // Loading state for invite fetch
  const [errMsg, setErrMsg]     = useState(null);
  const [imageError, setImageError] = useState(false);
  const imgRef = useRef(null);

  // Fetch invite information on mount
  useEffect(() => {
    async function fetchInviteInfo() {
      try {
        const invite = await getGuildInvite(inviteId);
        if (invite?.guild) {
          setGuildInfo(invite.guild);
          setGuildName(invite.guild.name);
        }
      } catch (err) {
        console.error('Failed to fetch invite info:', err);
        setErrMsg('This invite may be invalid or expired.');
        setState('error');
      } finally {
        setLoadingInvite(false);
      }
    }
    fetchInviteInfo();
  }, [inviteId]);

  // Hue based on invite id for a consistent colour splash
  // Convert string ID to a number for consistent color generation
  const hue = (inviteId.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0) * 67) % 360;

  async function handleJoin() {
    if (!isLoggedIn) {
      // Store the invite URL so we can redirect back after login
      // Support both BrowserRouter (pathname) and HashRouter (hash)
      let redirectPath = window.location.pathname;
      if (window.location.hash && window.location.hash.startsWith('#/')) {
        redirectPath = window.location.hash.slice(1); // Remove the # prefix
      }
      sessionStorage.setItem('postLoginRedirect', redirectPath);
      
      // Check if running in Electron
      if (isElectron()) {
        // Electron: Use external browser with local callback server
        setState('joining');
        try {
          const state = Array.from(crypto.getRandomValues(new Uint8Array(16)))
            .map(b => b.toString(16).padStart(2, '0')).join('');
          
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
          
          // Now join the guild
          const guild = await acceptGuildInvite(inviteId);
          setGuildName(guild.name);
          setState('joined');
          setTimeout(() => nav(`/app/guild/${guild.id}`), 1200);
        } catch (err) {
          setErrMsg(err.message || 'Failed to login');
          setState('error');
        }
      } else {
        // Web: Use normal redirect flow
        window.location.href = `${OAUTH_URL}?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code`;
      }
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
          background: (!guildInfo || imageError) ? `hsl(${hue},45%,35%)` : 'transparent',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: '2rem',
          color: '#fff',
          fontWeight: 700,
          overflow: 'hidden',
          position: 'relative',
        }}>
          {guildInfo && !imageError && (
            <img
              ref={imgRef}
              src={getGuildIconUrl(guildInfo.id)}
              alt={guildInfo.name}
              onError={() => setImageError(true)}
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                borderRadius: 'inherit',
                display: 'block',
              }}
            />
          )}
          {(!guildInfo || imageError) && (guildInfo ? (guildInfo.name?.[0]?.toUpperCase() || '?') : '🏰')}
        </div>

        {/* Copy */}
        <div>
          {loadingInvite && state === 'idle' ? (
            <>
              <div style={{ fontWeight: 800, fontSize: '1.3rem', color: '#f2f3f5', marginBottom: '0.4rem' }}>Loading invite…</div>
              <div style={{ color: '#72767d', fontSize: '0.9rem' }}>Please wait</div>
            </>
          ) : state === 'joined' ? (
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
              <div style={{ fontWeight: 800, fontSize: '1.3rem', color: '#f2f3f5', marginBottom: '0.4rem' }}>
                {guildInfo ? `Join ${guildInfo.name}` : "You've been invited!"}
              </div>
              <div style={{ color: '#72767d', fontSize: '0.9rem' }}>
                {isLoggedIn
                  ? guildInfo ? `Accept the invite to join ${guildInfo.name}.` : 'Click below to accept the guild invite.'
                  : 'Log in to accept this guild invite.'}
              </div>
            </>
          )}
        </div>

        {/* Action button */}
        {(state === 'idle' || state === 'joining') && (
          <button
            onClick={handleJoin}
            disabled={state === 'joining' || loadingInvite}
            style={{
              background: '#7c3aed', border: 'none', borderRadius: '8px',
              padding: '0.75rem 2rem', color: '#fff', fontSize: '1rem',
              fontWeight: 700, cursor: (state === 'joining' || loadingInvite) ? 'default' : 'pointer',
              opacity: (state === 'joining' || loadingInvite) ? 0.7 : 1, transition: 'background 0.15s',
              width: '100%',
            }}
            className={(state !== 'joining' && !loadingInvite) ? 'hov-accent' : undefined}
          >
            {state === 'joining' ? 'Joining…' : loadingInvite ? 'Loading…' : isLoggedIn ? 'Accept Invite' : 'Log in to Join'}
          </button>
        )}

        {state === 'already' && (
          <button onClick={() => nav('/app/friends')}
            style={{ background: '#383a40', border: 'none', borderRadius: '8px', padding: '0.75rem 2rem', color: '#f2f3f5', fontSize: '1rem', fontWeight: 700, cursor: 'pointer', width: '100%', transition: 'background 0.15s' }}
            className="hov-invite-already">
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
            className="hov-invite-back">
            Back to app
          </button>
        )}
      </div>
    </div>
  );
}
