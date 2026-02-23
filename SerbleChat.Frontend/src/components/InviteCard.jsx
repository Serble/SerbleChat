import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { acceptGuildInvite } from '../api.js';
import { useApp } from '../context/AppContext.jsx';

/**
 * A compact card shown when a guild invite link appears in a message.
 * Props: inviteId (string | number)
 */
export default function InviteCard({ inviteId }) {
  const { refreshGuilds, guilds, reconnectHub, setActiveGuildId } = useApp();
  const nav = useNavigate();
  const [state, setState]       = useState('idle'); // idle | joining | joined | already | error
  const [guildName, setGuildName] = useState(null);
  const [errMsg, setErrMsg]     = useState(null);

  // Check if user is already in this guild — we'll find out after accepting
  async function handleJoin() {
    setState('joining');
    try {
      const guild = await acceptGuildInvite(inviteId);
      setGuildName(guild.name);
      setState('joined');
      await refreshGuilds();
      await reconnectHub();
      setActiveGuildId(String(guild.id));
      // Short delay so the user sees "Joined!" before navigation
      setTimeout(() => nav(`/app/guild/${guild.id}`), 800);
    } catch (err) {
      if (err.message?.toLowerCase().includes('already a member')) {
        setState('already');
      } else {
        setErrMsg(err.message);
        setState('error');
      }
    }
  }

  // Hue for the guild icon — stable per invite id
  const hue = (Number(inviteId) * 67) % 360;

  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: '0.75rem',
      background: '#2b2d31', border: '1px solid #3b3d43',
      borderRadius: '8px', padding: '0.75rem 1rem',
      marginTop: '0.35rem', maxWidth: 340,
    }}>
      {/* Guild icon placeholder */}
      <div style={{
        width: 40, height: 40, borderRadius: '30%', flexShrink: 0,
        background: `hsl(${hue},40%,32%)`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: '1.2rem',
      }}>🏰</div>

      <div style={{ flex: 1, overflow: 'hidden' }}>
        <div style={{ fontSize: '0.7rem', color: '#72767d', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700, marginBottom: '0.1rem' }}>
          Guild Invite
        </div>
        <div style={{ fontSize: '0.88rem', color: '#f2f3f5', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {guildName ?? `Invite #${inviteId}`}
        </div>
      </div>

      {/* Action */}
      {state === 'idle' && (
        <button onClick={handleJoin}
          style={{ background: '#7c3aed', border: 'none', borderRadius: '6px', padding: '0.4rem 0.85rem', color: '#fff', fontSize: '0.82rem', fontWeight: 600, cursor: 'pointer', flexShrink: 0, transition: 'background 0.15s', whiteSpace: 'nowrap' }}
          onMouseEnter={e => e.currentTarget.style.background = '#6d28d9'}
          onMouseLeave={e => e.currentTarget.style.background = '#7c3aed'}>
          Join Guild
        </button>
      )}
      {state === 'joining' && (
        <span style={{ fontSize: '0.82rem', color: '#72767d', flexShrink: 0 }}>Joining…</span>
      )}
      {state === 'joined' && (
        <span style={{ fontSize: '0.82rem', color: '#23a55a', fontWeight: 600, flexShrink: 0 }}>✓ Joined!</span>
      )}
      {state === 'already' && (
        <button onClick={() => nav(`/app/friends`)}
          style={{ background: '#383a40', border: 'none', borderRadius: '6px', padding: '0.4rem 0.85rem', color: '#b5bac1', fontSize: '0.82rem', fontWeight: 600, cursor: 'pointer', flexShrink: 0, transition: 'background 0.15s', whiteSpace: 'nowrap' }}
          onMouseEnter={e => e.currentTarget.style.background = '#4a4c55'}
          onMouseLeave={e => e.currentTarget.style.background = '#383a40'}>
          Already joined
        </button>
      )}
      {state === 'error' && (
        <span style={{ fontSize: '0.75rem', color: '#f23f43', flexShrink: 0, maxWidth: 80 }} title={errMsg}>Failed</span>
      )}
    </div>
  );
}
