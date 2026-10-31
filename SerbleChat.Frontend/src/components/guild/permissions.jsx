// Shared permission definitions + the Allow/Deny/Inherit editor used by the
// roles, default-permissions and channel-override tabs.

// PermissionState enum: 0 = Allow, 1 = Deny, 2 = Inherit
export const ALLOW = 0;
export const DENY = 1;
export const INHERIT = 2;

/** True if the resolved perms grant `key` (administrator implies everything). */
export function allowed(perms, key) {
  if (!perms) return false;
  return perms.administrator === ALLOW || perms[key] === ALLOW;
}

/** Guild-wide permissions (roles and default permissions). */
export const GUILD_PERMS = [
  { key: 'administrator',  label: 'Administrator',   desc: 'Grants all permissions (use carefully)' },
  { key: 'manageGuild',    label: 'Manage Guild',    desc: 'Edit guild name & default perms' },
  { key: 'manageRoles',    label: 'Manage Roles',    desc: 'Create, edit and delete roles' },
  { key: 'manageChannels', label: 'Manage Channels', desc: 'Create, rename and delete channels' },
  { key: 'kickMembers',    label: 'Kick Members',    desc: 'Remove members from the guild' },
  { key: 'banMembers',     label: 'Ban Members',     desc: 'Permanently ban members' },
  { key: 'createInvites',  label: 'Create Invites',  desc: 'Generate invite links' },
  { key: 'viewChannel',    label: 'View Channel',    desc: 'See and read channels' },
  { key: 'sendMessages',   label: 'Send Messages',   desc: 'Post messages in channels' },
  { key: 'manageMessages', label: 'Manage Messages', desc: "Delete others' messages" },
  { key: 'joinVoice',      label: 'Join Voice',      desc: 'Connect to voice channels' },
  { key: 'speak',          label: 'Speak',           desc: 'Speak in voice channels' },
  { key: 'muteMembers',    label: 'Mute Members',    desc: 'Server-mute members in voice' },
  { key: 'deafenMembers',  label: 'Deafen Members',  desc: 'Server-deafen members in voice' },
  { key: 'moveMembers',    label: 'Move Members',    desc: 'Move members between voice channels' },
  { key: 'videoStream',    label: 'Video / Stream',  desc: 'Share video or screen' },
];

/** Same keys, channel-relevant ones first, worded for a single channel. */
export const CHANNEL_PERMS = [
  { key: 'viewChannel',    label: 'View Channel',    desc: 'See and read this channel' },
  { key: 'sendMessages',   label: 'Send Messages',   desc: 'Post messages in this channel' },
  { key: 'manageMessages', label: 'Manage Messages', desc: "Delete others' messages" },
  { key: 'manageChannels', label: 'Manage Channel',  desc: 'Rename or delete this channel' },
  { key: 'createInvites',  label: 'Create Invites',  desc: 'Generate invite links' },
  { key: 'joinVoice',      label: 'Join Voice',      desc: 'Connect to voice' },
  { key: 'speak',          label: 'Speak',           desc: 'Speak in voice channels' },
  { key: 'muteMembers',    label: 'Mute Members',    desc: 'Server-mute members in voice' },
  { key: 'deafenMembers',  label: 'Deafen Members',  desc: 'Server-deafen members in voice' },
  { key: 'moveMembers',    label: 'Move Members',    desc: 'Move members between voice channels' },
  { key: 'videoStream',    label: 'Video / Stream',  desc: 'Share video or screen' },
  { key: 'administrator',  label: 'Administrator',   desc: 'Grants all permissions (use carefully)' },
  { key: 'manageGuild',    label: 'Manage Guild',    desc: 'Edit guild name & settings' },
  { key: 'manageRoles',    label: 'Manage Roles',    desc: 'Create, edit and delete roles' },
  { key: 'kickMembers',    label: 'Kick Members',    desc: 'Remove members from the guild' },
  { key: 'banMembers',     label: 'Ban Members',     desc: 'Permanently ban members' },
];

const STATES = {
  [ALLOW]:   { label: 'Allow',   color: 'var(--success)' },
  [DENY]:    { label: 'Deny',    color: 'var(--danger)' },
  [INHERIT]: { label: 'Inherit', color: 'var(--text-muted)' },
};

// Inherit → Allow → Deny → Inherit
function nextState(s) { return s === INHERIT ? ALLOW : s === ALLOW ? DENY : INHERIT; }

/** One row per permission with a button that cycles Allow / Deny / Inherit. */
export function PermissionList({ keys, perms, onChange, disabled }) {
  const p = perms ?? {};
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {keys.map(({ key, label, desc }) => {
        const value = p[key] ?? INHERIT;
        const state = STATES[value] ?? STATES[INHERIT];
        return (
          <div key={key} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.45rem 0', borderBottom: '1px solid var(--border)' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-secondary)' }}>{label}</div>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{desc}</div>
            </div>
            <button
              type="button"
              disabled={disabled}
              title="Click to cycle Allow → Deny → Inherit"
              onClick={() => onChange({ ...p, [key]: nextState(value) })}
              style={{
                background: 'transparent', border: `1px solid ${state.color}`,
                borderRadius: 5, padding: '0.25rem 0.65rem',
                color: state.color, fontSize: '0.75rem', fontWeight: 700,
                cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.5 : 1,
                transition: 'color 0.15s, border-color 0.15s', minWidth: 64, flexShrink: 0,
              }}
            >
              {state.label}
            </button>
          </div>
        );
      })}
    </div>
  );
}
