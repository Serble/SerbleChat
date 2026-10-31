import { useEffect, useState } from 'react';
import { useApp } from '../context/AppContext.jsx';
import { PopupMenu } from './ui/index.js';
import NotifPrefRow, { NotifMenuHeader } from './guild/NotifPrefRow.jsx';

// NotificationPreference enum: Inherit=0, AllMessages=1, MentionsOnly=2, Nothing=3
const PREF_OPTIONS = [
  { value: 0, label: 'Inherit',       desc: 'Use parent/default setting' },
  { value: 1, label: 'All Messages',  desc: 'Every new message' },
  { value: 2, label: 'Mentions Only', desc: 'Only when mentioned' },
  { value: 3, label: 'Nothing',       desc: 'Never' },
];
const PREF_OPTIONS_NO_INHERIT = PREF_OPTIONS.filter(o => o.value !== 0);

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
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  const prefs = notifPrefs[String(channelId)];
  const options = allowInherit ? PREF_OPTIONS : PREF_OPTIONS_NO_INHERIT;

  // Load prefs if not cached yet
  useEffect(() => {
    if (!prefs) {
      setLoading(true);
      loadChannelNotifPrefs(channelId).finally(() => setLoading(false));
    }
  }, [channelId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function setPref(field, value) {
    if (busy) return;
    setBusy(true);
    try { await updateChannelNotifPrefs(channelId, { [field]: value }); }
    finally { setBusy(false); }
  }

  // Values come straight from the AppContext cache, which is only updated on a
  // successful save — so a failed save never shows a stale selection.
  return (
    <PopupMenu x={x} y={y} onClose={onClose} width={260}>
      <NotifMenuHeader title="Channel Notifications" />
      {loading ? (
        <div style={{ padding: '0.75rem', color: 'var(--text-subtle)', fontSize: '0.8rem' }}>Loading…</div>
      ) : (
        <>
          <NotifPrefRow label="Notifications" options={options} value={prefs?.notifications ?? 0} onChange={v => setPref('notifications', v)} busy={busy} />
          <NotifPrefRow label="Unread Badge"  options={options} value={prefs?.unreads ?? 0}       onChange={v => setPref('unreads', v)}       busy={busy} />
        </>
      )}
    </PopupMenu>
  );
}
