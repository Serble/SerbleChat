import { useState, useRef } from 'react';
import { useApp } from '../context/AppContext.jsx';
import { useVoice } from '../context/VoiceContext.jsx';
import { IconButton } from './ui/index.js';
import Avatar from './Avatar.jsx';
import UserPopout from './UserPopout.jsx';
import { MicIcon, MicOffIcon, HeadphonesIcon, HeadphonesOffIcon, LogoutIcon } from '../icons.jsx';
import { MenuItem } from './ui/index.js';
import { StatusMenu, CustomStatusModal } from './status/StatusPicker.jsx';
import { navigateToRoot } from '../electron-utils.js';
import { AvatarStatusDot } from './status/StatusDot.jsx';
import { STATUS_META } from './status/status.js';

/** Mic / deafen toggle: red with a struck-through icon while off. */
function PanelToggle({ off, onClick, disabled, title, Icon, OffIcon }) {
  return (
    <IconButton
      title={title}
      aria-label={title}
      aria-pressed={off}
      onClick={onClick}
      disabled={disabled}
      className={off ? undefined : 'hov-text-primary'}
      style={{
        width: 32, height: 32, flexShrink: 0, borderRadius: '6px',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: off ? 'var(--danger)' : 'var(--text-muted)',
        background: off ? 'color-mix(in srgb, var(--danger) 14%, transparent)' : undefined,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {off ? <OffIcon size={18} /> : <Icon size={18} />}
    </IconButton>
  );
}

/**
 * UserPanel
 * The "who you are" strip at the bottom of the sidebars. Clicking the
 * avatar/name opens your own profile card above it; right-clicking it opens a
 * menu to set your status or log out. The mic and deafen toggles work in and
 * out of calls (state carries into the next call).
 */
export default function UserPanel() {
  const { currentUser, ownStatus } = useApp();
  const { voiceMuted, voiceDeafened, toggleMute, toggleDeafen, voiceStatus, voiceParticipants } = useVoice();
  const [anchorRect, setAnchorRect] = useState(null);
  const [ctxMenu, setCtxMenu] = useState(null); // { x, y } of the right-click menu
  const [statusModalOpen, setStatusModalOpen] = useState(false);
  const btnRef = useRef(null);

  if (!currentUser) return null;
  const open = !!anchorRect;
  const connecting = voiceStatus === 'connecting';
  const speaking = !voiceMuted && !!voiceParticipants?.find(p => p.isLocal)?.isSpeaking;

  return (
    <div style={{
      padding: '0.4rem 0.5rem', background: 'var(--bg-user-panel)',
      display: 'flex', alignItems: 'center', gap: '0.15rem',
      flexShrink: 0,
    }}>
      <button
        ref={btnRef}
        type="button"
        title="View your profile"
        aria-haspopup="dialog"
        aria-expanded={open}
        className="hov-bg"
        // While the card is open, its outside-click handler would close it on
        // mousedown and this click would immediately reopen it — swallow the
        // mousedown so a second click acts as a toggle instead.
        onMouseDown={e => { if (open) e.stopPropagation(); }}
        onClick={() => setAnchorRect(open ? null : btnRef.current.getBoundingClientRect())}
        onContextMenu={e => {
          e.preventDefault();
          setAnchorRect(null);
          setCtxMenu({ x: e.clientX, y: e.clientY });
        }}
        style={{
          flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: '0.5rem',
          padding: '0.2rem 0.25rem', borderRadius: '6px', border: 'none',
          background: open ? 'var(--bg-hover)' : 'transparent',
          cursor: 'pointer', textAlign: 'left', font: 'inherit', color: 'inherit',
          transition: 'background 0.1s',
        }}
      >
        <div style={{
          position: 'relative', flexShrink: 0, borderRadius: '50%',
          // Speaking ring while you're talking in a call
          boxShadow: speaking ? '0 0 0 2px var(--bg-user-panel), 0 0 0 4px var(--success)' : 'none',
          transition: 'box-shadow 0.15s ease-in-out',
        }}>
          <Avatar userId={currentUser.id} name={currentUser.username} size={32} color={currentUser.color} />
          <AvatarStatusDot presence={ownStatus.presence} size={8} ring="var(--bg-user-panel)" />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            title={currentUser.username}
            style={{
              fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-primary)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}
          >
            {currentUser.username}
          </div>
          <div
            title={ownStatus.message || undefined}
            style={{
              fontSize: '0.7rem', color: 'var(--text-muted)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}
          >
            {ownStatus.message || STATUS_META[ownStatus.presence].label}
          </div>
        </div>
      </button>

      <PanelToggle
        off={voiceMuted}
        onClick={toggleMute}
        disabled={connecting}
        title={voiceMuted ? 'Unmute' : 'Mute'}
        Icon={MicIcon}
        OffIcon={MicOffIcon}
      />
      <PanelToggle
        off={voiceDeafened}
        onClick={toggleDeafen}
        disabled={connecting}
        title={voiceDeafened ? 'Undeafen' : 'Deafen'}
        Icon={HeadphonesIcon}
        OffIcon={HeadphonesOffIcon}
      />

      {ctxMenu && (
        <StatusMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          label="Set status"
          onClose={() => setCtxMenu(null)}
          onCustom={() => setStatusModalOpen(true)}
        >
          <MenuItem
            icon={LogoutIcon}
            label="Log out"
            variant="danger"
            onClick={() => { localStorage.removeItem('jwt'); navigateToRoot(); }}
          />
        </StatusMenu>
      )}
      {statusModalOpen && <CustomStatusModal onClose={() => setStatusModalOpen(false)} />}

      {open && (
        <UserPopout
          userId={currentUser.id}
          username={currentUser.username}
          anchorRect={anchorRect}
          placement="above"
          onClose={() => setAnchorRect(null)}
        />
      )}
    </div>
  );
}
