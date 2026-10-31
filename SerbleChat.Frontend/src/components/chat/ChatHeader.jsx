import { useVoice } from '../../context/VoiceContext.jsx';
import { useMobile } from '../../context/MobileContext.jsx';
import { getChannelIconUrl, getGroupChatIconUrl } from '../../api.js';
import { IconButton } from '../ui/index.js';
import { PersonIcon, PeopleIcon, MenuIcon, MicIcon, SpeakerIcon, PlusIcon, DoorIcon } from '../../icons.jsx';
import './chat.css';

function HeaderBtn({ children, title, onClick, active, danger, disabled }) {
  return (
    <button
      type="button"
      className="chat-header-btn"
      data-active={!!active}
      data-danger={!!danger}
      title={title}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}

/** Small icon (or "#") shown before the channel name. */
function ChannelTypeIcon({ type }) {
  if (type === 1) return <PersonIcon size={16} />;
  if (type === 2) return <PeopleIcon size={16} />;
  return '#';
}

/**
 * Top bar of the chat view: channel name/icon, voice join button, group chat
 * actions and the member list toggle.
 */
export default function ChatHeader({
  channel, channelId, displayName, otherUser,
  hasChannelIcon, onIconError, iconVersion,
  isOwner, onAddMembers, onLeave, leaveBusy,
  showMembers, onToggleMembers,
}) {
  const { voiceChannelId, voiceStatus, voiceBusy, joinVoice, leaveVoice } = useVoice();
  const { isMobile, openSidebar } = useMobile() ?? { isMobile: false, openSidebar: () => {} };

  const isGuildChannel = channel?.type === 0;
  const isDmChannel    = channel?.type === 1;
  const isGroupChannel = channel?.type === 2;
  const voiceCapable   = isDmChannel || isGroupChannel || (isGuildChannel && channel?.voiceCapable);
  const inThisVoice    = voiceChannelId === Number(channelId);
  // Cache-buster so an updated icon is re-fetched
  const iconQuery      = iconVersion ? '?t=' + iconVersion : '';

  return (
    <div style={{
      height: 48, display: 'flex', alignItems: 'center', gap: '0.5rem',
      padding: '0 0.75rem 0 1.25rem', borderBottom: '1px solid var(--border)',
      flexShrink: 0, background: 'var(--bg-base)',
    }}>
      {/* Hamburger – only shown on mobile */}
      {isMobile && (
        <IconButton
          title="Open sidebar"
          onClick={openSidebar}
          style={{ color: 'var(--text-secondary)', padding: '0.25rem', marginRight: '0.15rem', flexShrink: 0 }}
        >
          <MenuIcon size={18} />
        </IconButton>
      )}

      {isGroupChannel && hasChannelIcon ? (
        // Group chat: show icon as avatar
        <img
          key={`header-group-icon-${channelId}-${iconVersion || 0}`}
          src={getGroupChatIconUrl(channelId) + iconQuery}
          alt="Group icon"
          onError={onIconError}
          style={{ width: 32, height: 32, borderRadius: '6px', flexShrink: 0, objectFit: 'cover' }}
        />
      ) : (
        <span style={{ fontSize: '1rem' }}><ChannelTypeIcon type={channel?.type} /></span>
      )}

      <span style={{ fontWeight: 700, color: 'var(--text-primary)', fontSize: '0.95rem', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
        {/* Guild channel icon (if exists) */}
        {isGuildChannel && hasChannelIcon && (
          <img
            key={`header-channel-icon-${channelId}-${iconVersion || 0}`}
            src={getChannelIconUrl(channel.guildId, channelId) + iconQuery}
            alt="Channel icon"
            onError={onIconError}
            style={{ width: 20, height: 20, borderRadius: '4px', flexShrink: 0, objectFit: 'cover' }}
          />
        )}
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {displayName}
        </span>
      </span>

      {isDmChannel && otherUser && !isMobile && (
        <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>Direct Message</span>
      )}

      {voiceCapable && (
        <HeaderBtn
          title={inThisVoice ? 'Leave Voice' : 'Join Voice'}
          onClick={inThisVoice ? leaveVoice : () => joinVoice(Number(channelId))}
          active={inThisVoice}
          disabled={voiceBusy || voiceStatus === 'connecting'}
        >
          {inThisVoice ? <SpeakerIcon size={16} /> : <MicIcon size={16} />}
        </HeaderBtn>
      )}

      {isGroupChannel && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', marginLeft: '0.5rem' }}>
          {isOwner && (
            <HeaderBtn title="Add Members" onClick={onAddMembers}><PlusIcon size={16} /></HeaderBtn>
          )}
          <HeaderBtn title="Leave Group" danger onClick={onLeave} disabled={leaveBusy}><DoorIcon size={16} /></HeaderBtn>
        </div>
      )}

      <HeaderBtn title="Member List" active={showMembers} onClick={onToggleMembers}><PeopleIcon size={16} /></HeaderBtn>
    </div>
  );
}
