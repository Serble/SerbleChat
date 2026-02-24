import { useEffect, useRef, useState } from 'react';
import { useApp } from '../context/AppContext.jsx';

// NotificationPreference enum: Inherit=0, AllMessages=1, MentionsOnly=2, Nothing=3
const PREF_OPTIONS = [
  { value: 0, icon: '↩', label: 'Inherit',       desc: 'Use your user default' },
  { value: 1, icon: '🔔', label: 'All Messages',  desc: 'Every message in every channel' },
  { value: 2, icon: '💬', label: 'Mentions Only', desc: 'Only when @mentioned' },
  { value: 3, icon: '🔕', label: 'Nothing',       desc: 'Never' },
];

function PrefRow({ label, value, onChange, busy }) {
  return (
    <div style={{ padding: '0.5rem 0.75rem' }}>
      <div style={{
        fontSize: '0.68rem', fontWeight: 700, color: 'var(--text-muted)',
        textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.3rem',
      }}>{label}</div>
      <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap' }}>
        {PREF_OPTIONS.map(opt => {
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

export default function GuildNotifContextMenu({ guildId, guildName, x, y, onClose }) {
  const { guildNotifPrefs, loadGuildNotifPrefs, updateGuildNotifPrefs } = useApp();
  const menuRef = useRef(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  const key = String(guildId);
  const cached = guildNotifPrefs[key];

  const [notif,   setNotif]   = useState(cached?.preferences?.notifications ?? 0);
  const [unreads, setUnreads] = useState(cached?.preferences?.unreads       ?? 0);

  // Keep refs in sync so the save closure always sees the latest values
  const notifRef   = useRef(notif);
  const unreadsRef = useRef(unreads);
  useEffect(() => { notifRef.current   = notif;   }, [notif]);
  useEffect(() => { unreadsRef.current = unreads; }, [unreads]);

  // Load prefs if not cached
  useEffect(() => {
    if (!cached) {
      setLoading(true);
      loadGuildNotifPrefs(guildId)
        .then(data => {
          if (data) {
            setNotif(data.preferences?.notifications ?? 0);
            setUnreads(data.preferences?.unreads     ?? 0);
          }
        })
        .finally(() => setLoading(false));
    } else {
      setNotif(cached.preferences?.notifications ?? 0);
      setUnreads(cached.preferences?.unreads     ?? 0);
    }
  }, [guildId]); // eslint-disable-line react-hooks/exhaustive-deps

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

  const menuWidth  = 270;
  const menuHeight = 220;
  const clampedX   = Math.min(x, window.innerWidth  - menuWidth  - 8);
  const clampedY   = Math.min(y, window.innerHeight - menuHeight - 8);

  async function save(newNotif, newUnreads) {
    setBusy(true);
    try {
      await updateGuildNotifPrefs(guildId, { notifications: newNotif, unreads: newUnreads });
    } finally {
      setBusy(false);
    }
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
        padding: '0.5rem 0.75rem 0.4rem',
        borderBottom: '1px solid var(--border)',
      }}>
        <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-primary)' }}>
          🔔 Notifications
        </div>
        {guildName && (
          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '0.1rem',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {guildName}
          </div>
        )}
      </div>

      {loading ? (
        <div style={{ padding: '0.75rem', color: 'var(--text-subtle)', fontSize: '0.8rem' }}>Loading…</div>
      ) : (
        <>
          <PrefRow
            label="Notifications"
            value={notif}
            onChange={v => { setNotif(v); notifRef.current = v; save(v, unreadsRef.current); }}
            busy={busy}
          />
          <PrefRow
            label="Unread Badge"
            value={unreads}
            onChange={v => { setUnreads(v); unreadsRef.current = v; save(notifRef.current, v); }}
            busy={busy}
          />
          <div style={{ padding: '0.3rem 0.75rem 0.5rem', fontSize: '0.7rem', color: 'var(--text-subtle)', lineHeight: 1.5 }}>
            Inherit uses your user defaults. Individual channels can override these.
          </div>
        </>
      )}
    </div>
  );
}
