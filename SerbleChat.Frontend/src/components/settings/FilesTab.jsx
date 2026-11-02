import { useState, useEffect, useCallback } from 'react';
import { filesGetAccount, filesGetLimits, filesGetUsage, formatBytes } from '../../filesApi.js';
import { useFilesAuth, connectFiles, startFilesConsent, withFilesToken } from '../../filesAuth.js';
import { Button, Card, ErrorBox, Hint } from '../ui/index.js';
import { FolderIcon, KeyLockIcon, WarningIcon } from '../../icons.jsx';
import { TabBody } from './common.jsx';

// The Files API uses -1 for "no limit"
function formatLimit(value, format = formatBytes) {
  return value === -1 ? 'Unlimited' : format(value);
}

const cardLabelStyle = {
  fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-muted)',
  textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: '0.75rem',
};

const NOT_CONNECTED_TITLES = {
  consent_required: 'Allow SerbleChat to use Serble Files',
  denied: 'Serble Files is unavailable',
  reauth_required: 'Sign in again to use Serble Files',
  unavailable: "Couldn't connect to Serble Files",
};

export default function FilesTab() {
  const { status, token, message } = useFilesAuth();
  const [info, setInfo] = useState(null); // { user, limits, usage }
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [working, setWorking] = useState(false);

  const loadInfo = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [user, limits, usage] = await withFilesToken(t => Promise.all([
        filesGetAccount(t),
        filesGetLimits(t),
        filesGetUsage(t),
      ]));
      setInfo({ user, limits, usage });
    } catch (err) {
      setError(`Failed to load your Serble Files account: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }, []);

  const connected = status === 'connected' && !!token;
  useEffect(() => {
    if (connected) loadInfo();
    else setInfo(null);
  }, [connected, loadInfo]);

  async function run(fn) {
    setWorking(true);
    try { await fn(); } finally { setWorking(false); }
  }

  const { user, limits, usage } = info ?? {};
  const usedPct = limits && usage && limits.accountFilesSize > 0
    ? Math.min(100, (usage.usedStorage / limits.accountFilesSize) * 100)
    : 0;

  return (
    <TabBody>
      <h3 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-primary)', margin: '0 0 0.5rem' }}>
        <FolderIcon size={16} /> Serble Files
      </h3>
      <Hint style={{ fontSize: '0.85rem', marginBottom: '1.5rem' }}>
        Files you attach in chat are uploaded to Serble Files with your Serble account. SerbleChat connects to it for you, so there's nothing to sign in to. Files can be set to expire.
      </Hint>

      <ErrorBox style={{ marginBottom: '1rem' }}>{error}</ErrorBox>

      {!connected ? (
        status === 'idle' || status === 'connecting' ? (
          <Card style={{ padding: '1.5rem', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
            Connecting to Serble Files…
          </Card>
        ) : (
          <Card style={{ padding: '1.5rem', textAlign: 'center' }}>
            {status === 'consent_required'
              ? <KeyLockIcon size={32} style={{ marginBottom: '0.75rem', color: 'var(--text-muted)' }} />
              : <WarningIcon size={32} style={{ marginBottom: '0.75rem', color: 'var(--text-muted)' }} />}
            <div style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.4rem' }}>
              {NOT_CONNECTED_TITLES[status] ?? NOT_CONNECTED_TITLES.unavailable}
            </div>
            <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '1rem', lineHeight: 1.5 }}>
              {status === 'consent_required'
                ? 'Serble needs your permission before SerbleChat can upload to your Serble Files account. Until then, uploads are anonymous and use the guest limits.'
                : (message || 'Uploads are anonymous and use the guest limits until this is fixed.')}
            </div>
            {status === 'consent_required' && message && (
              <div style={{ fontSize: '0.8rem', color: 'var(--danger)', marginBottom: '1rem' }}>{message}</div>
            )}
            {status === 'consent_required' ? (
              <Button variant="primary" onClick={() => run(startFilesConsent)} disabled={working}>
                {working ? 'Waiting for Serble…' : 'Allow access'}
              </Button>
            ) : status !== 'reauth_required' && (
              <Button variant="secondary" onClick={() => run(connectFiles)} disabled={working}>
                {working ? 'Connecting…' : 'Try again'}
              </Button>
            )}
          </Card>
        )
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

        </div>
      )}
    </TabBody>
  );
}
