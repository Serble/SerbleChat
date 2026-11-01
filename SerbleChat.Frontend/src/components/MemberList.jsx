import { useState, useEffect } from 'react';
import { getChannelMembers, getGuildChannelMembersDetails } from '../api.js';
import UserInteraction from './UserInteraction.jsx';
import { useApp } from '../context/AppContext.jsx';
import Avatar from './Avatar.jsx';
import { CrownIcon } from '../icons.jsx';

/**
 * Props:
 *  channelId   number | string
 *  guildId     number | string | null   (pass for guild channels)
 *  ownerId     string | null            (group owner, or null for DMs/guilds)
 *  refreshTick number                   (increment to force a reload)
 */
export default function MemberList({ channelId, guildId, ownerId, refreshTick, style: styleProp }) {
  const [members, setMembers]   = useState([]);
  const [loading, setLoading]   = useState(true);
  const [localTick, setLocalTick] = useState(0);

  const { rolesUpdatedEvent, userUpdatedEvent, userStatuses } = useApp();
  const isGuild = !!guildId;

  // When roles are updated for this guild, bump the local tick to re-fetch
  useEffect(() => {
    if (!rolesUpdatedEvent || !guildId) return;
    if (String(rolesUpdatedEvent.guildId) === String(guildId)) {
      setLocalTick(t => t + 1);
    }
  }, [rolesUpdatedEvent]); // eslint-disable-line react-hooks/exhaustive-deps

  // When any guild member's roles change (UserUpdated), re-fetch the member list
  useEffect(() => {
    if (!userUpdatedEvent || !guildId) return;
    setLocalTick(t => t + 1);
  }, [userUpdatedEvent]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!channelId) return;
    // Ignore responses from a previous channel / refresh that resolve late, so a
    // slow request can't overwrite the list for the channel now being shown.
    let cancelled = false;
    setLoading(true);
    const req = isGuild
      ? getGuildChannelMembersDetails(guildId, channelId)
      : getChannelMembers(channelId);
    req
      .then(m => { if (!cancelled) setMembers(m); })
      .catch(console.error)
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [channelId, guildId, refreshTick, localTick]); // eslint-disable-line react-hooks/exhaustive-deps

  // Normalise to { id, username, isOnline, color?, userColor? } regardless of source
  // color     = top role colour (guild only)
  // userColor = user's own profile colour
  const normalised = members.map(m => {
    const base = isGuild
      ? { id: m.user.id, username: m.user.username, isOnline: m.user.isOnline, color: m.color, userColor: m.user.color ?? '' }
      : { id: m.id, username: m.username, isOnline: m.isOnline, color: null, userColor: m.color ?? '' };
    // Override with live SignalR status when available
    const liveStatus = userStatuses[String(base.id)];
    if (liveStatus !== undefined) base.isOnline = liveStatus === 'online';
    return base;
  });

  const online  = normalised.filter(m => m.isOnline);
  const offline = normalised.filter(m => !m.isOnline);

  return (
    <div style={{
      width: 240, flexShrink: 0, background: 'var(--bg-secondary)',
      borderLeft: '1px solid var(--border)',
      display: 'flex', flexDirection: 'column', overflow: 'hidden',
      ...styleProp,
    }}>
      <div style={{
        height: 48, display: 'flex', alignItems: 'center',
        padding: '0 1rem', borderBottom: '1px solid var(--border)', flexShrink: 0,
      }}>
        <span style={{ fontWeight: 700, color: 'var(--text-primary)', fontSize: '0.875rem' }}>
          Members — {normalised.length}
        </span>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '0.75rem 0.5rem' }}>
        {loading && (
          <div style={{ color: 'var(--text-subtle)', fontSize: '0.82rem', padding: '0.5rem 0.5rem' }}>Loading…</div>
        )}

        {!loading && online.length > 0 && (
          <>
            <GroupHeader>Online — {online.length}</GroupHeader>
            {online.map(m => <MemberRow key={m.id} member={m} ownerId={ownerId} guildId={isGuild ? guildId : null} />)}
          </>
        )}

        {!loading && offline.length > 0 && (
          <>
            <GroupHeader top={online.length > 0 ? '0.75rem' : '0.25rem'}>Offline — {offline.length}</GroupHeader>
            {offline.map(m => <MemberRow key={m.id} member={m} ownerId={ownerId} guildId={isGuild ? guildId : null} />)}
          </>
        )}
      </div>
    </div>
  );
}

function GroupHeader({ children, top = '0.25rem' }) {
  return (
    <div style={{ fontSize: '0.68rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', padding: `${top} 0.5rem 0.4rem` }}>
      {children}
    </div>
  );
}

function MemberRow({ member, ownerId, guildId }) {
  const isOwner = ownerId && member.id === ownerId;
  // Priority: role colour > user profile colour > default (inherits the row's
  // colour, which brightens on hover)
  const nameColor =
    (member.color && member.color !== '#ffffff')
      ? member.color
      : member.userColor || 'inherit';

  return (
    <UserInteraction userId={member.id} username={member.username} guildId={guildId}>
      <div
        className="hov-bg hov-text-primary"
        style={{
          display: 'flex', alignItems: 'center', gap: '0.6rem',
          padding: '0.35rem 0.5rem', borderRadius: '6px', width: '100%',
          color: 'var(--text-secondary)',
          transition: 'background 0.1s, color 0.1s',
          opacity: member.isOnline ? 1 : 0.45,
        }}
      >
        <div style={{ position: 'relative', flexShrink: 0 }}>
          <Avatar userId={member.id} name={member.username} size={32} color={member.userColor} />
          <div style={{
            position: 'absolute', bottom: 0, right: 0,
            width: 10, height: 10, borderRadius: '50%',
            background: member.isOnline ? 'var(--success)' : 'var(--text-subtle)',
            border: '2px solid var(--bg-secondary)',
          }} />
        </div>
        <span style={{
          flex: 1, color: nameColor,
          fontSize: '0.875rem', fontWeight: 500,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {member.username}
        </span>
        {isOwner && (
          // Tooltip lives on a wrapper: a title attribute on an <svg> isn't shown
          <span title="Owner" style={{ display: 'flex', color: '#f0b232', flexShrink: 0 }}>
            <CrownIcon size={16} />
          </span>
        )}
      </div>
    </UserInteraction>
  );
}
