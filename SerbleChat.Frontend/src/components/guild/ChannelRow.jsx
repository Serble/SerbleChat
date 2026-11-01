import { useState } from 'react';
import { useApp } from '../../context/AppContext.jsx';
import { getChannelIconUrl } from '../../api.js';
import ChannelNotifContextMenu from '../ChannelNotifContextMenu.jsx';
import VoiceUserChips from '../voice/VoiceUserChips.jsx';
import useIconProbe from './useIconProbe.js';
import { MicIcon, GearIcon, SpeakerIcon } from '../../icons.jsx';

// ─── Channel Row ──────────────────────────────────────────────────────────────

const rowIconBtn = {
  background: 'transparent', border: 'none', cursor: 'pointer',
  padding: '0.15rem 0.25rem', borderRadius: 3, lineHeight: 1,
  display: 'flex', alignItems: 'center', flexShrink: 0, transition: 'color 0.1s',
};

/**
 * dropEdge: 'top' | 'bottom' | null — where the dragged channel would land
 * relative to this row (shown as an accent line).
 */
export default function ChannelRow({ ch, canManage, active, onNavigate, onSettings, onVoiceJoin,
                                     onDragStart, onDragEnter, onDragEnd, onDrop, dropEdge }) {
  const { unreads, channelUpdatedEvent } = useApp();
  // Drives the drag handle / settings gear, which only show while hovering the row
  const [hovered, setHovered] = useState(false);
  const [ctxMenu, setCtxMenu] = useState(null); // { x, y }
  const [iconSrc, markIconMissing] = useIconProbe(getChannelIconUrl(ch.guildId, ch.id), channelUpdatedEvent, 'channelId', ch.id);
  const unread = unreads[String(ch.id)] ?? 0;

  function handleContextMenu(e) {
    e.preventDefault();
    setCtxMenu({ x: e.clientX, y: e.clientY });
  }

  return (
    <>
      <div
        draggable={canManage}
        onDragStart={canManage ? onDragStart : undefined}
        onDragEnter={canManage ? onDragEnter : undefined}
        onDragEnd={canManage ? onDragEnd : undefined}
        onDragOver={canManage ? e => e.preventDefault() : undefined}
        onDrop={canManage ? onDrop : undefined}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          display: 'flex', alignItems: 'center', gap: '0.25rem',
          padding: '0.1rem 0.25rem 0.1rem 0',
          borderRadius: 6,
          background: dropEdge ? 'var(--accent-soft)' : 'transparent',
          borderTop: '2px solid transparent',
          boxShadow: dropEdge === 'top' ? 'inset 0 2px 0 var(--accent)'
                   : dropEdge === 'bottom' ? 'inset 0 -2px 0 var(--accent)'
                   : 'none',
          transition: 'background 0.1s',
          cursor: canManage ? 'grab' : 'default',
        }}
      >
        {/* Drag handle */}
        {canManage && (
          <span style={{
            color: hovered ? 'var(--text-subtle)' : 'transparent',
            fontSize: '0.75rem', lineHeight: 1, padding: '0 0.1rem',
            flexShrink: 0, cursor: 'grab', userSelect: 'none',
            transition: 'color 0.1s',
          }}>⠿</span>
        )}

        <button
          onClick={onNavigate}
          onContextMenu={handleContextMenu}
          className={active ? undefined : 'hov-bg hov-text-secondary'}
          style={{
            display: 'flex', alignItems: 'center', gap: '0.35rem',
            padding: '0.3rem 0.4rem', borderRadius: 5, flex: 1,
            background: active ? 'var(--bg-active)' : 'transparent',
            border: 'none', cursor: 'pointer', textAlign: 'left',
            color: active ? 'var(--text-primary)' : 'var(--text-muted)',
            fontSize: '0.875rem', fontWeight: active || unread > 0 ? 600 : 400,
            transition: 'background 0.1s, color 0.1s',
            minWidth: 0,
          }}
        >
          {/* Channel icon or default symbol */}
          {iconSrc ? (
            <img
              src={iconSrc}
              alt="Channel icon"
              onError={markIconMissing}
              style={{ width: 16, height: 16, borderRadius: 4, flexShrink: 0, objectFit: 'cover' }}
            />
          ) : (
            <span style={{ color: hovered || active ? 'var(--text-muted)' : 'var(--text-subtle)', fontSize: '0.85rem', flexShrink: 0, lineHeight: 1 }}>
              {ch.voiceCapable ? <SpeakerIcon size={14} /> : '#'}
            </span>
          )}
          <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ch.name}</span>
          {unread > 0 && !active && (
            <span style={{
              background: 'var(--danger)', color: '#fff', borderRadius: 9999,
              padding: '0.1rem 0.38rem', fontSize: '0.68rem', fontWeight: 700,
              minWidth: 18, textAlign: 'center', flexShrink: 0,
            }}>
              {unread > 99 ? '99+' : unread}
            </span>
          )}
        </button>

        {ch.voiceCapable && onVoiceJoin && (
          <button
            title="Join Voice"
            onClick={e => { e.stopPropagation(); onVoiceJoin(); }}
            className="hov-text-primary"
            style={{ ...rowIconBtn, color: hovered ? 'var(--text-secondary)' : 'var(--text-muted)' }}
          ><MicIcon size={16} /></button>
        )}

        {/* Settings icon — only visible to managers on hover */}
        {canManage && hovered && (
          <button
            title="Channel Settings"
            onClick={e => { e.stopPropagation(); onSettings(); }}
            className="hov-text-primary"
            style={{ ...rowIconBtn, color: 'var(--text-muted)' }}
          ><GearIcon size={16} /></button>
        )}
      </div>
      {ctxMenu && (
        <ChannelNotifContextMenu
          channelId={ch.id}
          x={ctxMenu.x}
          y={ctxMenu.y}
          onClose={() => setCtxMenu(null)}
        />
      )}

      {/* Voice participants below voice-capable channels */}
      {ch.voiceCapable && <VoiceUserChips channelId={ch.id} style={{ padding: '0.2rem 0.4rem 0.2rem 2rem' }} />}
    </>
  );
}
