// Shared permission definitions + the Allow/Deny/Inherit editor used by the
// roles, default-permissions and channel-override tabs.
import { Segmented } from '../ui/index.js';
import { CheckIcon, CrossIcon, MinusIcon } from '../../icons.jsx';

// PermissionState enum: 0 = Allow, 1 = Deny, 2 = Inherit
export const ALLOW = 0;
export const DENY = 1;
export const INHERIT = 2;

/** True if the resolved perms grant `key` (administrator implies everything). */
export function allowed(perms, key) {
  if (!perms) return false;
  return perms.administrator === ALLOW || perms[key] === ALLOW;
}

const PERMS = {
  administrator:  { label: 'Administrator',   desc: 'Grants every permission and bypasses channel overrides. Use carefully.', warn: true },
  manageGuild:    { label: 'Manage Guild',    desc: "Edit the guild's name, icon, invites and default permissions" },
  manageRoles:    { label: 'Manage Roles',    desc: 'Create, edit and delete roles' },
  manageChannels: { label: 'Manage Channels', desc: 'Create, rename and delete channels', channelLabel: 'Manage Channel', channelDesc: 'Rename or delete this channel' },
  createInvites:  { label: 'Create Invites',  desc: 'Generate invite links' },
  kickMembers:    { label: 'Kick Members',    desc: 'Remove members from the guild' },
  banMembers:     { label: 'Ban Members',     desc: 'Ban members from the guild' },
  viewChannel:    { label: 'View Channels',   desc: 'See channels and read their messages', channelLabel: 'View Channel', channelDesc: 'See this channel and read its messages' },
  sendMessages:   { label: 'Send Messages',   desc: 'Post messages in channels', channelDesc: 'Post messages in this channel' },
  manageMessages: { label: 'Manage Messages', desc: "Delete other members' messages and end their polls" },
  createPolls:    { label: 'Create Polls',    desc: 'Post polls in channels', channelDesc: 'Post polls in this channel' },
  joinVoice:      { label: 'Connect',         desc: 'Join voice channels', channelDesc: "Join this channel's voice call" },
  speak:          { label: 'Speak',           desc: 'Talk in voice channels' },
  videoStream:    { label: 'Video & Screen',  desc: 'Share a camera or screen in voice' },
  muteMembers:    { label: 'Mute Members',    desc: 'Server-mute other members in voice' },
  deafenMembers:  { label: 'Deafen Members',  desc: 'Server-deafen other members in voice' },
  moveMembers:    { label: 'Move Members',    desc: 'Move members between voice channels' },
};

const GROUPS = {
  general: { title: 'General',     keys: ['administrator', 'manageGuild', 'manageRoles', 'manageChannels', 'createInvites'] },
  members: { title: 'Members',     keys: ['kickMembers', 'banMembers'] },
  text:    { title: 'Text',        keys: ['viewChannel', 'sendMessages', 'createPolls', 'manageMessages'] },
  voice:   { title: 'Voice',       keys: ['joinVoice', 'speak', 'videoStream', 'muteMembers', 'deafenMembers', 'moveMembers'] },
};

/** Guild-wide permissions (roles and default permissions). */
export const GUILD_PERM_GROUPS = [GROUPS.general, GROUPS.members, GROUPS.text, GROUPS.voice];

/** Same keys, channel-relevant ones first, worded for a single channel. */
export const CHANNEL_PERM_GROUPS = [
  GROUPS.text,
  GROUPS.voice,
  { title: 'Channel', keys: ['manageChannels', 'createInvites'] },
  { title: 'Guild-wide', keys: ['administrator', 'manageGuild', 'manageRoles', 'kickMembers', 'banMembers'] },
];

const STATE_OPTIONS = [
  { value: DENY,    icon: CrossIcon, title: 'Deny',    tone: 'danger' },
  { value: INHERIT, icon: MinusIcon, title: 'Inherit', tone: 'neutral' },
  { value: ALLOW,   icon: CheckIcon, title: 'Allow',   tone: 'success' },
];

/** Every permission set to `state` (used for "reset all"). */
export function allPerms(groups, state) {
  return Object.fromEntries(groups.flatMap(g => g.keys).map(k => [k, state]));
}

/** Number of permissions explicitly set to Allow / Deny. */
export function countSet(perms) {
  const values = Object.values(perms ?? {});
  return { allow: values.filter(v => v === ALLOW).length, deny: values.filter(v => v === DENY).length };
}

/**
 * Permission editor: one row per permission with a Deny / Inherit / Allow
 * switch, grouped under small headings. `channel` picks the per-channel
 * wording.
 */
export function PermissionList({ groups, perms, onChange, disabled, channel = false }) {
  const p = perms ?? {};
  return (
    <div className="perm-list">
      {groups.map(group => (
        <section key={group.title} className="perm-group">
          <div className="perm-group-title">{group.title}</div>
          {group.keys.map(key => {
            const info = PERMS[key];
            const value = p[key] ?? INHERIT;
            const label = (channel && info.channelLabel) || info.label;
            return (
              <div key={key} className="perm-row" data-state={value}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="perm-label" data-warn={!!info.warn}>{label}</div>
                  <div className="perm-desc">{(channel && info.channelDesc) || info.desc}</div>
                </div>
                <Segmented
                  size="sm"
                  options={STATE_OPTIONS}
                  value={value}
                  disabled={disabled}
                  onChange={v => onChange({ ...p, [key]: v })}
                  aria-label={label}
                />
              </div>
            );
          })}
        </section>
      ))}
    </div>
  );
}

/** Small legend explaining the three states, shown above a PermissionList. */
export function PermissionLegend({ inheritText = 'falls back to roles and defaults' }) {
  const item = (Icon, color, text) => (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}>
      <Icon size={12} style={{ color }} /> {text}
    </span>
  );
  return (
    <div className="ui-hint" style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem 1rem' }}>
      {item(CheckIcon, 'var(--success)', 'Allow')}
      {item(CrossIcon, 'var(--danger)', 'Deny')}
      {item(MinusIcon, 'var(--text-muted)', `Inherit — ${inheritText}`)}
    </div>
  );
}
