import { useState, useEffect, useRef } from 'react';
import { useApp } from '../../context/AppContext.jsx';
import { useMobile } from '../../context/MobileContext.jsx';
import { isPushSupported, getPushUnsupportedReason, getPermissionState, isPushEnabled, enablePush, disablePush } from '../../push.js';
import { isInstalled, canInstall, promptInstall, onInstallAvailabilityChange } from '../../pwa.js';
import { Button, SaveStatus, SectionTitle, ToggleRow, OptionGroup, Hint, useFlashStatus } from '../ui/index.js';
import { BellIcon, BellOffIcon, ChatIcon, ErrorDotIcon, WarningIcon, XCircleIcon, CheckIcon, LightbulbIcon, DownloadIcon } from '../../icons.jsx';
import { TabBody } from './common.jsx';

// NotificationPreference enum: Inherit=0, AllMessages=1, MentionsOnly=2, Nothing=3
// Inherit isn't offered here — user defaults are the bottom of the hierarchy.
const NOTIF_PREF_OPTIONS = [
  { value: 1, icon: BellIcon,    label: 'All Messages',  description: 'Every new message' },
  { value: 2, icon: ChatIcon,    label: 'Mentions Only', description: 'Only when @mentioned' },
  { value: 3, icon: BellOffIcon, label: 'Nothing',       description: 'Never notify' },
];

const SCOPES = [
  { key: 'defaultDmNotificationPreferences',    title: 'Direct Messages',  description: 'Applied to all DM conversations.',                                         defaults: { notifications: 1, unreads: 1 } },
  { key: 'defaultGroupNotificationPreferences', title: 'Group Chats',      description: 'Applied to all group chats.',                                              defaults: { notifications: 2, unreads: 1 } },
  { key: 'defaultGuildNotificationPreferences', title: 'Guilds / Servers', description: 'Applied to all guild channels unless the guild or channel overrides it.', defaults: { notifications: 2, unreads: 1 } },
];

const SAVE_DEBOUNCE_MS = 500;

function prefsFromUser(user) {
  const prefs = { notificationsWhileOnline: user?.notificationsWhileOnline ?? false };
  for (const s of SCOPES) {
    prefs[s.key] = {
      notifications: user?.[s.key]?.notifications ?? s.defaults.notifications,
      unreads:       user?.[s.key]?.unreads       ?? s.defaults.unreads,
    };
  }
  return prefs;
}

const preStyle = {
  margin: 0, padding: '0.5rem 0.65rem',
  background: 'var(--bg-secondary)', borderRadius: 6,
  fontFamily: 'monospace', fontSize: '0.72rem',
  whiteSpace: 'pre-wrap', wordBreak: 'break-word',
  border: '1px solid var(--border)',
};

// ─── Push notifications ───────────────────────────────────────────────────────

function PushSection() {
  const [enabled, setEnabled] = useState(isPushEnabled);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState({ outcome: null, message: '' });

  if (!isPushSupported()) {
    return <Hint style={{ fontSize: '0.85rem' }}><WarningIcon size={14} /> Your browser does not support Web Push notifications.</Hint>;
  }

  const unsupportedReason = getPushUnsupportedReason();
  if (unsupportedReason) {
    return (
      <>
        <div style={{ fontSize: '0.78rem', color: 'var(--danger)', lineHeight: 1.6, marginBottom: '0.4rem' }}>
          <WarningIcon size={14} /> Push notifications are not available in this environment:
        </div>
        <pre style={{ ...preStyle, color: 'var(--text-muted)' }}>{unsupportedReason}</pre>
      </>
    );
  }

  const blocked = getPermissionState() === 'denied';

  async function handleToggle() {
    if (pending) return;
    setPending(true);
    setResult({ outcome: null, message: '' });
    try {
      if (enabled) {
        await disablePush();
        setEnabled(false);
      } else {
        const res = await enablePush();
        if (res.outcome === 'granted') setEnabled(true);
        setResult(res);
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <ToggleRow
      title="Browser push notifications"
      description={enabled
        ? 'You will receive push notifications even when the tab is closed.'
        : 'Enable to receive notifications when the app is in the background.'}
      checked={enabled}
      onChange={handleToggle}
      disabled={pending || blocked}
      toggleTitle={blocked ? 'Notifications are blocked in your browser settings' : undefined}
    >
      <div style={{ fontSize: '0.78rem', lineHeight: 1.5, marginTop: '0.5rem' }}>
        {result.outcome === 'denied' && (
          <div style={{ color: 'var(--danger)' }}>
            <XCircleIcon size={14} /> {result.message || 'Notification permission was denied. Please allow notifications in your browser settings and try again.'}
          </div>
        )}
        {result.outcome === 'error' && (
          <div style={{ color: 'var(--danger)' }}>
            <div style={{ marginBottom: '0.3rem' }}><XCircleIcon size={14} /> Failed to enable push notifications:</div>
            <pre style={{ ...preStyle, color: 'var(--danger)' }}>{result.message}</pre>
          </div>
        )}
        {result.outcome === 'granted' && (
          <div style={{ color: 'var(--success)' }}><CheckIcon size={11} /> Push notifications enabled!</div>
        )}
        {blocked && (
          <div style={{ color: 'var(--text-muted)' }}>
            Notifications are blocked by your browser. Open your browser's site settings to allow them.
          </div>
        )}
      </div>
    </ToggleRow>
  );
}

// ─── PWA install ──────────────────────────────────────────────────────────────

function InstallSection() {
  const [installed, setInstalled] = useState(isInstalled);
  const [installable, setInstallable] = useState(canInstall);
  const [installing, setInstalling] = useState(false);

  useEffect(() => onInstallAvailabilityChange(setInstallable), []);

  if (installed) return null;

  async function handleInstall() {
    if (installing) return;
    setInstalling(true);
    const { outcome } = await promptInstall();
    if (outcome === 'accepted') {
      setInstalled(true);
    }
    setInstallable(canInstall());
    setInstalling(false);
  }

  return (
    <>
      <SectionTitle>Progressive Web App</SectionTitle>
      {installable ? (
        <div style={{ marginBottom: '1.5rem' }}>
          <div style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.2rem' }}>
            Install SerbleChat
          </div>
          <Hint style={{ marginBottom: '0.75rem' }}>
            Install SerbleChat as an app on your device. It will launch in its own window and can be
            opened from your home screen or app menu.
          </Hint>
          <Button variant="primary" onClick={handleInstall} disabled={installing}>
            <DownloadIcon size={16} /> {installing ? 'Installing…' : 'Install App'}
          </Button>
        </div>
      ) : (
        <Hint style={{ fontSize: '0.85rem', marginBottom: '1.5rem' }}>
          <LightbulbIcon size={14} /> SerbleChat can be installed as an app on supported browsers.
          The install option will appear automatically when available.
        </Hint>
      )}
    </>
  );
}

// ─── Default notification preferences ─────────────────────────────────────────

function ScopePrefs({ title, description, value, onChange }) {
  const { isMobile } = useMobile();
  const pickers = [
    { field: 'notifications', label: <><BellIcon size={13} /> Notifications</> },
    { field: 'unreads',       label: <><ErrorDotIcon size={13} /> Unread Badge</> },
  ];
  return (
    <>
      <SectionTitle>{title}</SectionTitle>
      <Hint style={{ marginTop: '-0.6rem', marginBottom: '0.85rem', color: 'var(--text-subtle)' }}>{description}</Hint>
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: '1rem' }}>
        {pickers.map(p => (
          <div key={p.field}>
            <div style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.55rem' }}>
              {p.label}
            </div>
            <OptionGroup
              gap="0.4rem"
              options={NOTIF_PREF_OPTIONS}
              value={value[p.field]}
              onChange={v => onChange({ ...value, [p.field]: v })}
            />
          </div>
        ))}
      </div>
    </>
  );
}

export default function NotificationsTab() {
  const { currentUser, updateUserDefaultPrefs } = useApp();
  const [prefs, setPrefs] = useState(() => prefsFromUser(currentUser));
  const [saveStatus, flashSaveStatus, setSaveStatus] = useFlashStatus();
  const saveTimerRef = useRef(null);

  // Re-sync if the logged-in account changes underneath us
  useEffect(() => { setPrefs(prefsFromUser(currentUser)); }, [currentUser?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => clearTimeout(saveTimerRef.current), []);

  function update(patch) {
    const next = { ...prefs, ...patch };
    setPrefs(next);
    setSaveStatus('saving');
    clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      try {
        await updateUserDefaultPrefs(next);
        flashSaveStatus('saved', 2000);
      } catch {
        flashSaveStatus('error', 3000);
      }
    }, SAVE_DEBOUNCE_MS);
  }

  return (
    <TabBody>
      <div style={{ height: '1.2rem', marginTop: '-0.75rem', marginBottom: '0.25rem', display: 'flex', justifyContent: 'flex-end' }}>
        <SaveStatus status={saveStatus} errorText="Failed to save" />
      </div>

      <SectionTitle style={{ marginTop: 0 }}>Push Notifications</SectionTitle>
      <div style={{ marginBottom: '1.5rem' }}>
        <PushSection />
      </div>

      <InstallSection />

      <SectionTitle>Online Behaviour</SectionTitle>
      <ToggleRow
        title="Receive notifications while online"
        description="When enabled, push notifications are sent even if you are currently active in the app. Disable to suppress push notifications while you have a session open."
        checked={prefs.notificationsWhileOnline}
        onChange={v => update({ notificationsWhileOnline: v })}
      />

      <Hint style={{ marginTop: '2rem' }}>
        The sections below are your <strong style={{ color: 'var(--text-secondary)' }}>default</strong> notification
        preferences. They apply to all channels unless overridden at the guild or channel level.
      </Hint>

      {SCOPES.map(s => (
        <ScopePrefs
          key={s.key}
          title={s.title}
          description={s.description}
          value={prefs[s.key]}
          onChange={v => update({ [s.key]: v })}
        />
      ))}
    </TabBody>
  );
}
