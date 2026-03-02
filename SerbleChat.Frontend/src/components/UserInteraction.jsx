import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../context/AppContext.jsx';
import { useVoice } from '../context/VoiceContext.jsx';
import { useClientOptions } from '../context/ClientOptionsContext.jsx';
import { setParticipantMuted, setParticipantVolume } from '../voice.js';
import { getOrCreateDmChannel, kickGuildMember, banGuildMember } from '../api.js';
import UserPopout from './UserPopout.jsx';
import BanModal from './BanModal.jsx';

/**
 * UserContextMenu
 * Context menu that appears on right-click with "View Profile", "Message", "Block", and guild moderation options
 */
function UserContextMenu({ x, y, userId, username, onClose, onViewProfile, voiceSettings = null, onVoiceSettingsChange = null, guildId = null, myPerms = null, onOpenBanModal = null }) {
  const nav = useNavigate();
  const { blockUser, unblockUser, isBlocked, currentUser } = useApp();
  const menuRef = useRef(null);
  const blocked = isBlocked ? isBlocked(userId) : false;
  const [showVolumeControl, setShowVolumeControl] = useState(false);
  const [busy, setBusy] = useState(false);

  const isSelf = currentUser?.id === userId;
  const canKick = guildId && myPerms && !isSelf && (myPerms.administrator === 0 || myPerms.kickMembers === 0);
  const canBan = guildId && myPerms && !isSelf && (myPerms.administrator === 0 || myPerms.banMembers === 0);

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') onClose();
    }
    function onDown(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) onClose();
    }
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
    };
  }, [onClose]);

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
      if (blocked) {
        await unblockUser(userId);
      } else {
        await blockUser(userId);
      }
      onClose();
    } catch (e) {
      console.error(e);
      onClose();
    }
  }

  function handleViewProfile() {
    onViewProfile();
    onClose();
  }

  function handleToggleMute() {
    if (onVoiceSettingsChange) {
      onVoiceSettingsChange({ muted: !voiceSettings.muted });
    }
  }

  function handleVolumeChange(e) {
    if (onVoiceSettingsChange) {
      const newVolume = parseFloat(e.target.value);
      onVoiceSettingsChange({ volume: newVolume });
    }
  }

  function handleResetVoiceSettings() {
    if (onVoiceSettingsChange) {
      onVoiceSettingsChange({ muted: false, volume: 1 });
    }
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

  // Clamp menu position
  const menuW = 180;
  let menuH = voiceSettings ? 240 : 120;
  if (canKick || canBan) menuH += 60; // Add space for moderation options
  let left = x;
  let top = y;
  if (left + menuW > window.innerWidth) left = window.innerWidth - menuW - 8;
  if (top + menuH > window.innerHeight) top = window.innerHeight - menuH - 8;
  if (left < 8) left = 8;
  if (top < 8) top = 8;

  return (
    <>
      {createPortal(
        <div
          ref={menuRef}
          style={{
            position: 'fixed',
            zIndex: 700,
            left,
            top,
            minWidth: menuW,
            background: 'var(--bg-overlay)',
            border: '1px solid var(--border)',
            borderRadius: '6px',
            boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
            padding: '0.4rem',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.15rem',
          }}
        >
          <MenuItem label="View Profile" onClick={handleViewProfile} />
          <MenuItem label="Message" onClick={handleMessage} />
          {voiceSettings && (
            <>
              <div style={{ height: '1px', background: 'var(--border)', margin: '0.25rem 0' }} />
              <MenuItem label={voiceSettings.muted ? '🔇 Unmute' : '🔊 Mute'} onClick={handleToggleMute} />
              <div style={{ padding: '0.4rem 0.65rem' }}>
                <label style={{
                  fontSize: '0.7rem',
                  color: 'var(--text-secondary)',
                  fontWeight: 500,
                  display: 'block',
                  marginBottom: '0.3rem',
                }}>
                  Volume: {Math.round(voiceSettings.volume * 100)}%
                </label>
                <input
                  type="range"
                  min={0}
                  max={500}
                  step={5}
                  value={Math.round(voiceSettings.volume * 100)}
                  onChange={(e) => {
                    if (onVoiceSettingsChange) {
                      const newVolume = parseInt(e.target.value) / 100;
                      onVoiceSettingsChange({ volume: newVolume });
                    }
                  }}
                  style={{
                    cursor: 'pointer',
                    height: '4px',
                    width: '100%',
                  }}
                />
              </div>
              {(voiceSettings.muted || voiceSettings.volume !== 1) && (
                <MenuItem label="Reset" onClick={handleResetVoiceSettings} />
              )}
            </>
          )}
          {(canKick || canBan) && (
            <>
              <div style={{ height: '1px', background: 'var(--border)', margin: '0.25rem 0' }} />
              {canKick && <MenuItem label="Kick from Guild" onClick={handleKick} variant="danger" disabled={busy} />}
              {canBan && onOpenBanModal && <MenuItem label="Ban from Guild" onClick={() => onOpenBanModal(userId, username, guildId)} variant="danger" disabled={busy} />}
            </>
          )}
          <MenuItem label={blocked ? 'Unblock' : 'Block'} onClick={handleBlock} variant="danger" />
        </div>,
        document.body
      )}
    </>
  );
}

function MenuItem({ label, onClick, variant = 'default', disabled = false }) {
  const [hovered, setHovered] = useState(false);
  const isDanger = variant === 'danger';

  return (
    <button
      onClick={disabled ? undefined : onClick}
      onMouseEnter={() => !disabled && setHovered(true)}
      onMouseLeave={() => !disabled && setHovered(false)}
      disabled={disabled}
      style={{
        display: 'flex',
        alignItems: 'center',
        padding: '0.5rem 0.65rem',
        borderRadius: '4px',
        background: hovered ? (isDanger ? 'rgba(242,63,67,0.15)' : 'var(--bg-hover)') : 'transparent',
        border: 'none',
        color: isDanger && hovered ? 'var(--danger)' : hovered ? 'var(--text-primary)' : 'var(--text-secondary)',
        fontSize: '0.875rem',
        fontWeight: 500,
        cursor: disabled ? 'default' : 'pointer',
        textAlign: 'left',
        transition: 'background 0.1s, color 0.1s',
        width: '100%',
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {label}
    </button>
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
  const [hovered, setHovered] = useState(false);

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
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{ 
          cursor: isDisabled ? 'default' : 'pointer',
          transition: 'opacity 0.1s',
          opacity: hovered && !isDisabled ? 0.9 : 1,
        }}
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
            try {
              await banGuildMember(banModal.guildId, banModal.userId, until.toISOString());
              setBanModal(null);
            } catch (e) {
              console.error(e);
              alert('Failed to ban user: ' + e.message);
            }
          }}
          onCancel={() => setBanModal(null)}
          busy={false}
        />
      )}
    </>
  );
}
