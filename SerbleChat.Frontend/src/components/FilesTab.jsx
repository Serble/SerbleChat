import { useState, useEffect } from 'react';
import { useClientOptions } from '../context/ClientOptionsContext.jsx';
import { filesAuthenticateWithCode, filesGetAccount, filesGetLimits, filesGetUsage, formatBytes, FILES_OAUTH_URL, FILES_CLIENT_ID, FILES_REDIRECT_URI } from '../filesApi.js';

// ─── Files Tab ────────────────────────────────────────────────────────────────

export function FilesTab({ isActive }) {
  const { filesApiToken, setFilesApiToken } = useClientOptions();
  const [user, setUser] = useState(null);
  const [limits, setLimits] = useState(null);
  const [usage, setUsage] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Handle OAuth callback event
  useEffect(() => {
    function handleOAuthSuccess(event) {
      const { token } = event.detail;
      setFilesApiToken(token);
      setUser(null); // Clear user data to force reload
    }

    window.addEventListener('filesOAuthSuccess', handleOAuthSuccess);
    return () => window.removeEventListener('filesOAuthSuccess', handleOAuthSuccess);
  }, [setFilesApiToken]);

  // Auto-refresh user data when tab becomes active
  useEffect(() => {
    if (isActive && filesApiToken && !user && !loading) {
      loadUserData();
    }
  }, [isActive]);

  // Load user info and limits when token changes
  useEffect(() => {
    if (!isActive) return;
    if (!filesApiToken) {
      setUser(null);
      return;
    }
    loadUserData();
  }, [filesApiToken, isActive]);

  async function loadUserData() {
    setLoading(true);
    setError(null);
    try {
      const [userData, limitsData, usageData] = await Promise.all([
        filesGetAccount(filesApiToken),
        filesGetLimits(filesApiToken),
        filesGetUsage(filesApiToken),
      ]);
      setUser(userData);
      setLimits(limitsData);
      setUsage(usageData);
    } catch (err) {
      setError(`Failed to load Files API info: ${err.message}`);
      console.error('[FilesTab] Error:', err);
    } finally {
      setLoading(false);
    }
  }

  function handleLogin() {
    // Save state for validation after OAuth callback
    const state = crypto.getRandomValues(new Uint8Array(16));
    const stateStr = Array.from(state).map(b => b.toString(16).padStart(2, '0')).join('');
    sessionStorage.setItem('files_oauth_state', stateStr);

    const oauthUrl = new URL(FILES_OAUTH_URL);
    oauthUrl.searchParams.set('client_id', FILES_CLIENT_ID);
    oauthUrl.searchParams.set('redirect_uri', FILES_REDIRECT_URI);
    oauthUrl.searchParams.set('response_type', 'code');
    oauthUrl.searchParams.set('state', stateStr);
    oauthUrl.searchParams.set('scope', 'user_info');

    window.location.href = oauthUrl.toString();
  }

  function handleLogout() {
    setFilesApiToken(null);
    setUser(null);
    setLimits(null);
    setUsage(null);
  }

  if (!isActive) return null;

  return (
    <div style={{ padding: '1.5rem', overflowY: 'auto', flex: 1 }}>
      <h3 style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '0.5rem' }}>
        📁 Files API
      </h3>
      <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '1.5rem', lineHeight: 1.6 }}>
        Authenticate with the Files API to upload files for sharing in chat. Files are stored securely and can be set to expire.
      </p>

      {error && (
        <div style={{
          background: 'rgba(242,63,67,0.12)',
          border: '1px solid rgba(242,63,67,0.35)',
          borderRadius: 6,
          padding: '0.75rem',
          color: '#f23f43',
          fontSize: '0.85rem',
          marginBottom: '1rem',
        }}>
          {error}
        </div>
      )}

      {!filesApiToken ? (
        // Not authenticated
        <div style={{ background: 'var(--bg-secondary)', borderRadius: 8, padding: '1.5rem', textAlign: 'center' }}>
          <div style={{ fontSize: '2rem', marginBottom: '0.75rem' }}>🔐</div>
          <div style={{ fontSize: '0.95rem', color: 'var(--text-secondary)', marginBottom: '1rem' }}>
            Not connected to Files API
          </div>
          <button
            onClick={handleLogin}
            style={{
              background: 'var(--accent)',
              border: 'none',
              borderRadius: 6,
              color: '#fff',
              padding: '0.6rem 1.5rem',
              fontSize: '0.875rem',
              fontWeight: 600,
              cursor: 'pointer',
            }}
            className="hov-accent"
          >
            Login with Serble
          </button>
        </div>
      ) : (
        // Authenticated
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          {/* User info */}
          <div style={{ background: 'var(--bg-secondary)', borderRadius: 8, padding: '1rem' }}>
            <div style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: '0.75rem' }}>
              Account
            </div>
            {loading ? (
              <div style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>Loading...</div>
            ) : user ? (
              <div>
                <div style={{ marginBottom: '0.5rem' }}>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Username</div>
                  <div style={{ fontSize: '0.95rem', color: 'var(--text-primary)', fontWeight: 500 }}>{user.username}</div>
                </div>
                {user.isAdmin && (
                  <div style={{ fontSize: '0.75rem', color: 'var(--success)', background: 'rgba(52,211,153,0.1)', padding: '0.3rem 0.6rem', borderRadius: 4, width: 'fit-content' }}>
                    Admin
                  </div>
                )}
              </div>
            ) : null}
          </div>

          {/* Storage usage */}
          {limits && usage && (
            <div style={{ background: 'var(--bg-secondary)', borderRadius: 8, padding: '1rem' }}>
              <div style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: '0.75rem' }}>
                Storage
              </div>
              <div style={{ marginBottom: '0.75rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem' }}>
                  <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Used / Total</span>
                  <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                    {formatBytes(usage.usedStorage)} / {formatBytes(limits.accountFilesSize)}
                  </span>
                </div>
                <div style={{ width: '100%', height: 8, background: 'var(--bg-input)', borderRadius: 4, overflow: 'hidden' }}>
                  <div
                    style={{
                      height: '100%',
                      background: 'var(--accent)',
                      width: `${Math.min(100, (usage.usedStorage / limits.accountFilesSize) * 100)}%`,
                      transition: 'width 0.3s ease',
                    }}
                  />
                </div>
              </div>

              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', lineHeight: 1.6 }}>
                <div style={{ marginTop: '0.75rem' }}>
                  <strong style={{ color: 'var(--text-secondary)' }}>Max single file (no expiry):</strong> {formatBytes(limits.noExpirySingleFileSize)}
                </div>
                <div>
                  <strong style={{ color: 'var(--text-secondary)' }}>Max single file (with expiry):</strong> {formatBytes(limits.expirySingleFileSize)}
                </div>
                <div>
                  <strong style={{ color: 'var(--text-secondary)' }}>Max expiry time:</strong> {limits.maxExpiryHours} hours
                </div>
              </div>
            </div>
          )}

          {/* Logout button */}
          <button
            onClick={handleLogout}
            style={{
              background: 'var(--bg-active)',
              border: 'none',
              borderRadius: 6,
              color: 'var(--text-secondary)',
              padding: '0.6rem 1.5rem',
              fontSize: '0.875rem',
              cursor: 'pointer',
              alignSelf: 'flex-start',
            }}
            className="hov-bg"
          >
            Logout
          </button>
        </div>
      )}
    </div>
  );
}
