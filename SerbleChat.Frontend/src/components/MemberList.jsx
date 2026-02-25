import { useState, useEffect } from 'react';
import { getChannelMembers, getGuildChannelMembersDetails } from '../api.js';
import UserPopout from './UserPopout.jsx';
import { useApp } from '../context/AppContext.jsx';
import { avatarBg } from '../userColor.js';

function Avatar({ name, size = 32, color }) {
  const initial = name ? name[0].toUpperCase() : '?';
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      background: avatarBg(name, color),
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      color: '#fff', fontWeight: 700, fontSize: size * 0.42,
      flexShrink: 0, userSelect: 'none',
    }}>
      {initial}
    </div>
  );
}

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
  const [popout,  setPopout]    = useState(null);
  const [localTick, setLocalTick] = useState(0);

  const { rolesUpdatedEvent, userUpdatedEvent } = useApp();
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
    setLoading(true);
    const req = isGuild
      ? getGuildChannelMembersDetails(guildId, channelId)
      : getChannelMembers(channelId);
    req
      .then(setMembers)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [channelId, guildId, refreshTick, localTick]); // eslint-disable-line react-hooks/exhaustive-deps

  // Normalise to { id, username, isOnline, color?, userColor? } regardless of source
  // color     = top role colour (guild only)
  // userColor = user's own profile colour
  const normalised = members.map(m =>
    isGuild
      ? { id: m.user.id, username: m.user.username, isOnline: m.user.isOnline, color: m.color, userColor: m.user.color ?? '' }
      : { id: m.id, username: m.username, isOnline: m.isOnline, color: null, userColor: m.color ?? '' }
  );

  function handleClick(e, member) {
    const rect = e.currentTarget.getBoundingClientRect();
    setPopout({ userId: member.id, username: member.username, anchorRect: rect });
  }

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
            <div style={{ fontSize: '0.68rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', padding: '0.25rem 0.5rem 0.4rem' }}>
              Online — {online.length}
            </div>
            {online.map(m => <MemberRow key={m.id} member={m} ownerId={ownerId} onClick={handleClick} />)}
          </>
        )}

        {!loading && offline.length > 0 && (
          <>
            <div style={{ fontSize: '0.68rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', padding: '0.75rem 0.5rem 0.4rem' }}>
              Offline — {offline.length}
            </div>
            {offline.map(m => <MemberRow key={m.id} member={m} ownerId={ownerId} onClick={handleClick} />)}
          </>
        )}
      </div>

      {popout && (
        <UserPopout
          userId={popout.userId}
          username={popout.username}
          anchorRect={popout.anchorRect}
          onClose={() => setPopout(null)}
          guildId={isGuild ? guildId : null}
        />
      )}
    </div>
  );
}

function MemberRow({ member, ownerId, onClick }) {
  const [hovered, setHovered] = useState(false);
  const isOwner = ownerId && member.id === ownerId;
  // Priority: role colour > user profile colour > default
  const nameColor =
    (member.color && member.color !== '#ffffff' && member.color !== '')
      ? member.color
      : (member.userColor && member.userColor !== '')
        ? member.userColor
        : (hovered ? 'var(--text-primary)' : 'var(--text-secondary)');

  return (
    <button
      onClick={e => onClick(e, member)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: '0.6rem',
        padding: '0.35rem 0.5rem', borderRadius: '6px', width: '100%',
        background: hovered ? 'var(--bg-hover)' : 'transparent',
        border: 'none', cursor: 'pointer', textAlign: 'left',
        transition: 'background 0.1s',
        opacity: member.isOnline ? 1 : 0.45,
      }}
    >
      <div style={{ position: 'relative', flexShrink: 0 }}>
        <Avatar name={member.username} size={32} color={member.userColor} />
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
        transition: 'color 0.1s',
      }}>
        {member.username}
      </span>
      {isOwner && (
        <span title="Group Owner" style={{ fontSize: '0.8rem', flexShrink: 0 }}>👑</span>
      )}
    </button>
  );
}
