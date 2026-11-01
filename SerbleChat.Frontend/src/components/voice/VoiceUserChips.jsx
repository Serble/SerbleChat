import { useState, useEffect } from 'react';
import { useApp } from '../../context/AppContext.jsx';
import Avatar from '../Avatar.jsx';
import UserInteraction from '../UserInteraction.jsx';
import { VoiceStatusIcons } from './VoiceControls.jsx';

/**
 * Chips for the people in a voice channel, shown under the channel in the sidebar
 * (visible whether or not you're in the call), with their mute/deafen state.
 * `style` overrides the container (mainly its padding, which differs per sidebar).
 */
export default function VoiceUserChips({ channelId, style }) {
  const [users, setUsers] = useState({});
  const { resolveUser, voiceUsersByChannel, voiceStatesByChannel, primeVoiceUsers } = useApp();
  const userIds = voiceUsersByChannel[String(channelId)] ?? [];
  const states = voiceStatesByChannel[String(channelId)] ?? {};

  useEffect(() => {
    primeVoiceUsers(channelId);
  }, [channelId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    userIds.forEach(id => {
      if (!users[id]) {
        resolveUser(id).then(user => {
          setUsers(prev => ({ ...prev, [id]: user }));
        });
      }
    });
  }, [userIds]); // eslint-disable-line react-hooks/exhaustive-deps

  if (userIds.length === 0) return null;

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem', alignItems: 'center', ...style }}>
      {userIds.map(id => {
        const user = users[id];
        const name = user?.username ?? id.slice(0, 10);
        const state = states[id];
        const label = state?.deafened ? `${name} (deafened)` : state?.muted ? `${name} (muted)` : name;
        return (
          <UserInteraction key={id} userId={user?.id} username={name}>
            <div
              title={label}
              style={{
                display: 'flex', alignItems: 'center', gap: '0.25rem',
                padding: '0.2rem 0.35rem', borderRadius: 3,
                background: 'var(--accent-softer)',
                fontSize: '0.75rem', color: 'var(--text-secondary)',
              }}
            >
              <Avatar userId={user?.id} name={name} size={16} color={user?.color} />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 80 }}>
                {name}
              </span>
              <VoiceStatusIcons isMuted={state?.muted} isDeafened={state?.deafened} size={11} />
            </div>
          </UserInteraction>
        );
      })}
    </div>
  );
}
