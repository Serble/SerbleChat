import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../context/AppContext.jsx';
import { useVoice } from '../context/VoiceContext.jsx';
import { useClientOptions } from '../context/ClientOptionsContext.jsx';
import { setParticipantMuted, setParticipantVolume } from '../voice.js';
import { getOrCreateDmChannel, kickGuildMember, banGuildMember } from '../api.js';
import UserPopout from './UserPopout.jsx';
import BanModal from './BanModal.jsx';
import { ContextMenu, MenuItem, MenuDivider, Slider } from './ui/index.js';
import { SpeakerMutedIcon, SpeakerIcon } from '../icons.jsx';

/**
 * UserContextMenu
 * Context menu that appears on right-click with "View Profile", "Message", "Block", and guild moderation options
 */
function UserContextMenu({ x, y, userId, username, onClose, onViewProfile, voiceSettings = null, onVoiceSettingsChange = null, guildId = null, myPerms = null, onOpenBanModal = null }) {
  const nav = useNavigate();
  const { blockUser, unblockUser, isBlocked, currentUser } = useApp();
  const blocked = isBlocked ? isBlocked(userId) : false;
  const [busy, setBusy] = useState(false);

  const isSelf = currentUser?.id === userId;
  const canKick = guildId && myPerms && !isSelf && (myPerms.administrator === 0 || myPerms.kickMembers === 0);
  const canBan = guildId && myPerms && !isSelf && (myPerms.administrator === 0 || myPerms.banMembers === 0);

  async function handleMessage() {
    try {
      const ch = await getOrCreateDmChannel(userId);
      onClose();
      nav(`/app/channel/${ch.id}`);
    } catch (e) {
      console.error(e);
      onClose();
    }
  }

  async function handleBlock() {
    try {
      if (blocked) await unblockUser(userId);
      else await blockUser(userId);
    } catch (e) {
      console.error(e);
    }
    onClose();
  }

  function handleViewProfile() {
    onViewProfile();
    onClose();
  }

  async function handleKick() {
    if (!guildId || busy) return;
    if (!confirm(`Kick ${username} from this guild?`)) return;
    setBusy(true);
    try {
      await kickGuildMember(guildId, userId);
      onClose();
    } catch (e) {
      console.error(e);
      alert('Failed to kick user: ' + e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <ContextMenu x={x} y={y} onClose={onClose} minWidth={180}>
      <MenuItem label="View Profile" onClick={handleViewProfile} />
      <MenuItem label="Message" onClick={handleMessage} />
      {voiceSettings && (
        <>
          <MenuDivider />
          <MenuItem
            icon={voiceSettings.muted ? SpeakerMutedIcon : SpeakerIcon}
            label={voiceSettings.muted ? 'Unmute' : 'Mute'}
            onClick={() => onVoiceSettingsChange?.({ muted: !voiceSettings.muted })}
          />
          <div style={{ padding: '0.4rem 0.75rem' }}>
            <div style={{
              display: 'flex', justifyContent: 'space-between',
              fontSize: '0.7rem', color: 'var(--text-secondary)', fontWeight: 500, marginBottom: '0.4rem',
            }}>
              <span>Volume</span>
              <span style={{ fontVariantNumeric: 'tabular-nums' }}>{Math.round(voiceSettings.volume * 100)}%</span>
            </div>
            <Slider
              min={0}
              max={500}
              step={5}
              value={Math.round(voiceSettings.volume * 100)}
              onChange={v => onVoiceSettingsChange?.({ volume: v / 100 })}
            />
          </div>
          {(voiceSettings.muted || voiceSettings.volume !== 1) && (
            <MenuItem label="Reset" onClick={() => onVoiceSettingsChange?.({ muted: false, volume: 1 })} />
          )}
        </>
      )}
      {(canKick || canBan) && (
        <>
          <MenuDivider />
          {canKick && <MenuItem label="Kick from Guild" onClick={handleKick} variant="danger" disabled={busy} />}
          {canBan && onOpenBanModal && <MenuItem label="Ban from Guild" onClick={() => onOpenBanModal(userId, username, guildId)} variant="danger" disabled={busy} />}
        </>
      )}
      <MenuItem label={blocked ? 'Unblock' : 'Block'} onClick={handleBlock} variant="danger" />
    </ContextMenu>
  );
}

/**
 * UserInteraction
 * Reusable wrapper component that makes any child clickable for user interactions:
 * - Left click: Opens user profile popout
 * - Right click: Opens context menu with "View Profile", "Message", "Block"
 * 
 * Usage:
 * <UserInteraction userId={user.id} username={user.username} guildId={guildId}>
 *   <div>Your clickable content</div>
 * </UserInteraction>
 * 
 * Props:
 * - userId: string | number - The user's ID
 * - username: string - The user's username
 * - guildId: string | number | null - Optional guild ID for role management in popout
 * - voiceSettings: object | null - Optional { muted, volume } for voice controls in context menu
 * - onVoiceSettingsChange: function | null - Callback when voice settings change
 * - children: ReactNode - The content to make clickable
 * - disabled: boolean - If true, disables interaction (default: false)
 */
export default function UserInteraction({ userId, username, guildId = null, voiceSettings = null, onVoiceSettingsChange = null, children, disabled = false }) {
  const { voiceSession, voiceParticipants, refreshParticipants } = useVoice();
  const { getVoiceParticipantSetting, setVoiceParticipantSetting } = useClientOptions();
  const { getMyPerms } = useApp();
  const [popout, setPopout] = useState(null);
  const [contextMenu, setContextMenu] = useState(null);
  const [banModal, setBanModal] = useState(null); // { userId, username, guildId }
  const [banBusy, setBanBusy] = useState(false);

  // Disable interaction if userId is not available
  const isDisabled = disabled || !userId;

  // Get permissions if in a guild
  const myPerms = guildId ? getMyPerms(guildId) : null;

  // Check if this user is in the current voice session
  const userIdStr = userId?.toString() || "";
  const voiceParticipant = voiceSession && voiceParticipants && !disabled
    ? voiceParticipants.find(p => !p.isLocal && (p.identity?.toString() === userIdStr || p.identity === userId || p.identity === userIdStr))
    : null;

  // Use the actual participant identity from voiceParticipants (which is what's stored in participantAudioElements)
  const participantId = voiceParticipant ? voiceParticipant.identity : null;
  const effectiveVoiceSettings = voiceSettings || (participantId ? getVoiceParticipantSetting(participantId?.toString() || participantId) : null);
  
  // Create handler if user is in voice session
  const effectiveVoiceSettingsHandler = participantId ? (newSettings) => {
    const settingsKey = participantId?.toString() || participantId;
    const current = effectiveVoiceSettings || { muted: false, volume: 1 };
    const updated = { ...current, ...newSettings };
    setVoiceParticipantSetting(settingsKey, updated);
    if (updated.muted !== undefined) {
      setParticipantMuted(voiceSession, settingsKey, updated.muted);
    }
    if (updated.volume !== undefined) {
      setParticipantVolume(voiceSession, settingsKey, updated.volume);
    }
    // Refresh participants to update UI immediately
    if (refreshParticipants) {
      refreshParticipants();
    }
  } : onVoiceSettingsChange;

  function handleClick(e) {
    if (isDisabled) return;
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    setPopout({ userId, username, anchorRect: rect });
  }

  function handleContextMenu(e) {
    if (isDisabled) return;
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY });
  }

  function handleViewProfile() {
    const rect = { left: contextMenu.x, right: contextMenu.x + 1, top: contextMenu.y, bottom: contextMenu.y + 1 };
    setPopout({ userId, username, anchorRect: rect });
  }

  return (
    <>
      <div
        onClick={handleClick}
        onContextMenu={handleContextMenu}
        className={isDisabled ? undefined : 'user-interact'}
        style={isDisabled ? { cursor: 'default' } : undefined}
      >
        {children}
      </div>

      {popout && (
        <UserPopout
          userId={popout.userId}
          username={popout.username}
          anchorRect={popout.anchorRect}
          onClose={() => setPopout(null)}
          guildId={guildId}
        />
      )}

      {contextMenu && (
        <UserContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          userId={userId}
          username={username}
          onClose={() => setContextMenu(null)}
          onViewProfile={handleViewProfile}
          voiceSettings={effectiveVoiceSettings}
          onVoiceSettingsChange={effectiveVoiceSettingsHandler}
          guildId={guildId}
          myPerms={myPerms}
          onOpenBanModal={(userId, username, guildId) => {
            setBanModal({ userId, username, guildId });
            setContextMenu(null);
          }}
        />
      )}

      {banModal && (
        <BanModal
          username={banModal.username}
          onBan={async (until) => {
            setBanBusy(true);
            try {
              await banGuildMember(banModal.guildId, banModal.userId, until.toISOString());
              setBanModal(null);
            } catch (e) {
              console.error(e);
              alert('Failed to ban user: ' + e.message);
            } finally {
              setBanBusy(false);
            }
          }}
          onCancel={() => setBanModal(null)}
          busy={banBusy}
        />
      )}
    </>
  );
}
