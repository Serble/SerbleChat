import { useState, useEffect } from 'react';
import { getChannelMembers } from '../api.js';
import UserPopout from './UserPopout.jsx';

function Avatar({ name, size = 32 }) {
  const initial = name ? name[0].toUpperCase() : '?';
  const hue = name ? (name.charCodeAt(0) * 37 + name.charCodeAt(name.length - 1) * 17) % 360 : 200;
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      background: `hsl(${hue},45%,40%)`,
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
 *  ownerId     string | null   (group owner, or null for DMs)
 *  refreshTick number          (increment to force a reload)
 */
export default function MemberList({ channelId, ownerId, refreshTick }) {
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [popout,  setPopout]  = useState(null);

  useEffect(() => {
    if (!channelId) return;
    setLoading(true);
    getChannelMembers(channelId)
      .then(setMembers)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [channelId, refreshTick]);

  function handleClick(e, member) {
    const rect = e.currentTarget.getBoundingClientRect();
    setPopout({ userId: member.id, username: member.username, anchorRect: rect });
  }

  const online  = members.filter(m => m.isOnline);
  const offline = members.filter(m => !m.isOnline);

  return (
    <div style={{
      width: 240, flexShrink: 0, background: '#2b2d31',
      borderLeft: '1px solid #1e1f22',
      display: 'flex', flexDirection: 'column', overflow: 'hidden',
    }}>
      <div style={{
        height: 48, display: 'flex', alignItems: 'center',
        padding: '0 1rem', borderBottom: '1px solid #1e1f22', flexShrink: 0,
      }}>
        <span style={{ fontWeight: 700, color: '#f2f3f5', fontSize: '0.875rem' }}>
          Members — {members.length}
        </span>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '0.75rem 0.5rem' }}>
        {loading && (
          <div style={{ color: '#4f5660', fontSize: '0.82rem', padding: '0.5rem 0.5rem' }}>Loading…</div>
        )}

        {!loading && online.length > 0 && (
          <>
            <div style={{ fontSize: '0.68rem', fontWeight: 700, color: '#72767d', textTransform: 'uppercase', letterSpacing: '0.07em', padding: '0.25rem 0.5rem 0.4rem' }}>
              Online — {online.length}
            </div>
            {online.map(m => <MemberRow key={m.id} member={m} ownerId={ownerId} onClick={handleClick} />)}
          </>
        )}

        {!loading && offline.length > 0 && (
          <>
            <div style={{ fontSize: '0.68rem', fontWeight: 700, color: '#72767d', textTransform: 'uppercase', letterSpacing: '0.07em', padding: '0.75rem 0.5rem 0.4rem' }}>
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
        />
      )}
    </div>
  );
}

function MemberRow({ member, ownerId, onClick }) {
  const [hovered, setHovered] = useState(false);
  const isOwner = ownerId && member.id === ownerId;

  return (
    <button
      onClick={e => onClick(e, member)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: '0.6rem',
        padding: '0.35rem 0.5rem', borderRadius: '6px', width: '100%',
        background: hovered ? '#35363c' : 'transparent',
        border: 'none', cursor: 'pointer', textAlign: 'left',
        transition: 'background 0.1s',
        opacity: member.isOnline ? 1 : 0.45,
      }}
    >
      {/* Avatar with online dot */}
      <div style={{ position: 'relative', flexShrink: 0 }}>
        <Avatar name={member.username} size={32} />
        <div style={{
          position: 'absolute', bottom: 0, right: 0,
          width: 10, height: 10, borderRadius: '50%',
          background: member.isOnline ? '#23a55a' : '#747f8d',
          border: '2px solid #2b2d31',
        }} />
      </div>
      <span style={{
        flex: 1, color: hovered ? '#f2f3f5' : '#dbdee1',
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
