import { useEffect, useRef, useState } from 'react';
import { useApp } from '../context/AppContext.jsx';

// NotificationPreference enum: Inherit=0, AllMessages=1, MentionsOnly=2, Nothing=3
const PREF_OPTIONS = [
  { value: 0, icon: '↩', label: 'Inherit',      desc: 'Use parent/default setting' },
  { value: 1, icon: '🔔', label: 'All Messages', desc: 'Every new message' },
  { value: 2, icon: '💬', label: 'Mentions Only',desc: 'Only when mentioned' },
  { value: 3, icon: '🔕', label: 'Nothing',      desc: 'Never' },
];
const PREF_OPTIONS_NO_INHERIT = PREF_OPTIONS.filter(o => o.value !== 0);

function PrefRow({ label, value, onChange, allowInherit, busy }) {
  const options = allowInherit ? PREF_OPTIONS : PREF_OPTIONS_NO_INHERIT;
  return (
    <div style={{ padding: '0.5rem 0.75rem' }}>
      <div style={{
        fontSize: '0.68rem', fontWeight: 700, color: 'var(--text-muted)',
        textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.3rem',
      }}>{label}</div>
      <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap' }}>
        {options.map(opt => {
          const active = value === opt.value;
          return (
            <button
              key={opt.value}
              title={opt.desc}
              onClick={() => !busy && onChange(opt.value)}
              style={{
                display: 'flex', alignItems: 'center', gap: '0.3rem',
                padding: '0.25rem 0.55rem', borderRadius: 6,
                border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
                background: active ? 'rgba(124,58,237,0.15)' : 'transparent',
                color: active ? 'var(--text-primary)' : 'var(--text-muted)',
                fontSize: '0.78rem', fontWeight: active ? 600 : 400,
                cursor: busy ? 'default' : 'pointer',
                transition: 'all 0.1s',
              }}
              onMouseEnter={e => { if (!active && !busy) e.currentTarget.style.background = 'var(--bg-hover)'; }}
              onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent'; }}
            >
              <span>{opt.icon}</span>
              <span>{opt.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Right-click context menu for a channel's notification settings.
 *
 * Props:
 *   channelId   – channel id
 *   x, y        – viewport coords
 *   onClose     – close callback
 *   allowInherit – whether to show the "Inherit" option (default true for channels)
 */
export default function ChannelNotifContextMenu({ channelId, x, y, onClose, allowInherit = true }) {
  const { notifPrefs, loadChannelNotifPrefs, updateChannelNotifPrefs } = useApp();
  const menuRef = useRef(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  const key = String(channelId);
  const prefs = notifPrefs[key];

  // Load prefs if not cached yet
  useEffect(() => {
    if (!prefs) {
      setLoading(true);
      loadChannelNotifPrefs(channelId).finally(() => setLoading(false));
    }
  }, [channelId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Close on outside click or Escape
  useEffect(() => {
    function onDown(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) onClose();
    }
    function onKey(e) { if (e.key === 'Escape') onClose(); }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  // Clamp to viewport so the menu doesn't go off-screen
  const menuWidth = 260;
  const menuHeight = 200;
  const clampedX = Math.min(x, window.innerWidth  - menuWidth  - 8);
  const clampedY = Math.min(y, window.innerHeight - menuHeight - 8);

  // defaults: Inherit (0)
  const currentNotifs = prefs?.notifications ?? 0;
  const currentUnreads = prefs?.unreads ?? 0;

  async function setPref(field, value) {
    if (busy) return;
    setBusy(true);
    await updateChannelNotifPrefs(channelId, { [field]: value });
    setBusy(false);
  }

  return (
    <div
      ref={menuRef}
      style={{
        position: 'fixed', left: clampedX, top: clampedY, zIndex: 9000,
        background: 'var(--bg-base)', border: '1px solid var(--border)',
        borderRadius: '8px', boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
        width: menuWidth, userSelect: 'none',
      }}
    >
      <div style={{
        padding: '0.5rem 0.75rem 0.2rem',
        fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-primary)',
        borderBottom: '1px solid var(--border)',
      }}>
        🔔 Channel Notifications
      </div>

      {loading ? (
        <div style={{ padding: '0.75rem', color: 'var(--text-subtle)', fontSize: '0.8rem' }}>Loading…</div>
      ) : (
        <>
          <PrefRow
            label="Notifications"
            value={currentNotifs}
            onChange={v => setPref('notifications', v)}
            allowInherit={allowInherit}
            busy={busy}
          />
          <PrefRow
            label="Unread Badge"
            value={currentUnreads}
            onChange={v => setPref('unreads', v)}
            allowInherit={allowInherit}
            busy={busy}
          />
        </>
      )}
    </div>
  );
}