import { useState, useEffect, useCallback } from 'react';
import { useClientOptions } from '../../context/ClientOptionsContext.jsx';
import { filesAuthenticateWithCode, filesGetAccount, filesGetLimits, filesGetUsage, formatBytes, FILES_OAUTH_URL, FILES_CLIENT_ID, FILES_REDIRECT_URI } from '../../filesApi.js';
import { isElectron, electronOAuthFlow } from '../../electron-utils.js';
import { Button, Card, ErrorBox, Hint } from '../ui/index.js';
import { FolderIcon, KeyLockIcon } from '../../icons.jsx';
import { TabBody } from './common.jsx';

const ELECTRON_REDIRECT_URI = 'http://localhost:13579/callback';

// The Files API uses -1 for "no limit"
function formatLimit(value, format = formatBytes) {
  return value === -1 ? 'Unlimited' : format(value);
}

function buildOAuthUrl(redirectUri, state) {
  const url = new URL(FILES_OAUTH_URL);
  url.searchParams.set('client_id', FILES_CLIENT_ID);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('state', state);
  url.searchParams.set('scope', 'user_info');
  return url.toString();
}

const cardLabelStyle = {
  fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-muted)',
  textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: '0.75rem',
};

export default function FilesTab() {
  const { filesApiToken, setFilesApiToken } = useClientOptions();
  const [info, setInfo] = useState(null); // { user, limits, usage }
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Web OAuth completes in FilesCallbackPage, which dispatches this event
  useEffect(() => {
    function handleOAuthSuccess(event) { setFilesApiToken(event.detail.token); }
    window.addEventListener('filesOAuthSuccess', handleOAuthSuccess);
    return () => window.removeEventListener('filesOAuthSuccess', handleOAuthSuccess);
  }, [setFilesApiToken]);

  const loadInfo = useCallback(async token => {
    setLoading(true);
    setError(null);
    try {
      const [user, limits, usage] = await Promise.all([
        filesGetAccount(token),
        filesGetLimits(token),
        filesGetUsage(token),
      ]);
      setInfo({ user, limits, usage });
    } catch (err) {
      setError(`Failed to load Files API info: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setInfo(null);
    if (filesApiToken) loadInfo(filesApiToken);
  }, [filesApiToken, loadInfo]);

  async function handleLogin() {
    setError(null);
    const state = Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join('');

    if (!isElectron()) {
      sessionStorage.setItem('files_oauth_state', state);
      window.location.href = buildOAuthUrl(FILES_REDIRECT_URI, state);
      return;
    }

    // Electron: open the system browser and wait for the local callback server
    setLoading(true);
    try {
      const callback = await electronOAuthFlow(buildOAuthUrl(ELECTRON_REDIRECT_URI, state));
      if (callback.state !== state) throw new Error('State mismatch - possible security issue');
      if (callback.authorized !== 'true' || !callback.code) throw new Error('Login was cancelled or denied');

      const data = await filesAuthenticateWithCode(callback.code);
      if (!data.accessToken) throw new Error('Server did not return an access token');
      setFilesApiToken(data.accessToken);
    } catch (err) {
      setError(`Login failed: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }

  const { user, limits, usage } = info ?? {};
  const usedPct = limits && usage && limits.accountFilesSize > 0
    ? Math.min(100, (usage.usedStorage / limits.accountFilesSize) * 100)
    : 0;

  return (
    <TabBody>
      <h3 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-primary)', margin: '0 0 0.5rem' }}>
        <FolderIcon size={16} /> Files API
      </h3>
      <Hint style={{ fontSize: '0.85rem', marginBottom: '1.5rem' }}>
        Authenticate with the Files API to upload files for sharing in chat. Files are stored securely and can be set to expire.
      </Hint>

      <ErrorBox style={{ marginBottom: '1rem' }}>{error}</ErrorBox>

      {!filesApiToken ? (
        <Card style={{ padding: '1.5rem', textAlign: 'center' }}>
          <KeyLockIcon size={32} style={{ marginBottom: '0.75rem', color: 'var(--text-muted)' }} />
          <div style={{ fontSize: '0.95rem', color: 'var(--text-secondary)', marginBottom: '1rem' }}>
            Not connected to Files API
          </div>
          <Button variant="primary" onClick={handleLogin} disabled={loading}>
            {loading ? 'Logging in…' : 'Login with Serble'}
          </Button>
        </Card>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <Card>
            <div style={cardLabelStyle}>Account</div>
            {loading && !user ? (
              <div style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>Loading…</div>
            ) : user && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Username</div>
                  <div style={{ fontSize: '0.95rem', color: 'var(--text-primary)', fontWeight: 500 }}>{user.username}</div>
                </div>
                {user.isAdmin && (
                  <span style={{
                    fontSize: '0.75rem', color: 'var(--success)', padding: '0.2rem 0.5rem', borderRadius: 4,
                    background: 'color-mix(in srgb, var(--success) 12%, transparent)',
                  }}>
                    Admin
                  </span>
                )}
              </div>
            )}
          </Card>

          {limits && usage && (
            <Card>
              <div style={cardLabelStyle}>Storage</div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem', fontSize: '0.85rem' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Used / Total</span>
                <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                  {formatBytes(usage.usedStorage)} / {formatLimit(limits.accountFilesSize)}
                </span>
              </div>
              <div style={{ height: 8, background: 'var(--bg-active)', borderRadius: 4, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${usedPct}%`, background: 'var(--accent)', transition: 'width 0.3s ease' }} />
              </div>

              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', lineHeight: 1.6, marginTop: '0.75rem' }}>
                <div><strong style={{ color: 'var(--text-secondary)' }}>Max single file (no expiry):</strong> {formatLimit(limits.noExpirySingleFileSize)}</div>
                <div><strong style={{ color: 'var(--text-secondary)' }}>Max single file (with expiry):</strong> {formatLimit(limits.expirySingleFileSize)}</div>
                <div><strong style={{ color: 'var(--text-secondary)' }}>Max expiry time:</strong> {formatLimit(limits.maxExpiryHours, h => `${h} hours`)}</div>
              </div>
            </Card>
          )}

          <div>
            <Button variant="secondary" onClick={() => setFilesApiToken(null)}>Logout</Button>
          </div>
        </div>
      )}
    </TabBody>
  );
}
