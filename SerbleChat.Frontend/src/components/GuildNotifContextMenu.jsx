import { useEffect, useState } from 'react';
import { useApp } from '../context/AppContext.jsx';
import { PopupMenu } from './ui/index.js';
import NotifPrefRow, { NotifMenuHeader } from './guild/NotifPrefRow.jsx';

// NotificationPreference enum: Inherit=0, AllMessages=1, MentionsOnly=2, Nothing=3
const PREF_OPTIONS = [
  { value: 0, label: 'Inherit',       desc: 'Use your user default' },
  { value: 1, label: 'All Messages',  desc: 'Every message in every channel' },
  { value: 2, label: 'Mentions Only', desc: 'Only when @mentioned' },
  { value: 3, label: 'Nothing',       desc: 'Never' },
];

function prefsOf(data) {
  return {
    notifications: data?.preferences?.notifications ?? 0,
    unreads:       data?.preferences?.unreads       ?? 0,
  };
}

export default function GuildNotifContextMenu({ guildId, guildName, x, y, onClose }) {
  const { guildNotifPrefs, loadGuildNotifPrefs, updateGuildNotifPrefs } = useApp();
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  const cached = guildNotifPrefs[String(guildId)];
  const [prefs, setPrefs] = useState(() => prefsOf(cached));

  // Load prefs if not cached
  useEffect(() => {
    if (cached) { setPrefs(prefsOf(cached)); return; }
    setLoading(true);
    loadGuildNotifPrefs(guildId)
      .then(data => { if (data) setPrefs(prefsOf(data)); })
      .finally(() => setLoading(false));
  }, [guildId]); // eslint-disable-line react-hooks/exhaustive-deps

  // The endpoint takes both fields, so always send the full pair
  async function update(field, value) {
    if (busy) return;
    const prev = prefs;
    const next = { ...prefs, [field]: value };
    setPrefs(next);
    setBusy(true);
    try {
      const saved = await updateGuildNotifPrefs(guildId, next);
      if (!saved) setPrefs(prev); // save failed — don't show a value that wasn't stored
    } finally {
      setBusy(false);
    }
  }

  return (
    <PopupMenu x={x} y={y} onClose={onClose} width={270}>
      <NotifMenuHeader title="Notifications" subtitle={guildName} />
      {loading ? (
        <div style={{ padding: '0.75rem', color: 'var(--text-subtle)', fontSize: '0.8rem' }}>Loading…</div>
      ) : (
        <>
          <NotifPrefRow label="Notifications" options={PREF_OPTIONS} value={prefs.notifications} onChange={v => update('notifications', v)} busy={busy} />
          <NotifPrefRow label="Unread Badge"  options={PREF_OPTIONS} value={prefs.unreads}       onChange={v => update('unreads', v)}       busy={busy} />
          <div style={{ padding: '0.3rem 0.75rem 0.5rem', fontSize: '0.7rem', color: 'var(--text-subtle)', lineHeight: 1.5 }}>
            Inherit uses your user defaults. Individual channels can override these.
          </div>
        </>
      )}
    </PopupMenu>
  );
}
