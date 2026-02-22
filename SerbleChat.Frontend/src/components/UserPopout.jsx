import { useState, useEffect, useRef } from 'react';
import { getAccountById } from '../api.js';

const ONLINE  = { label: 'Online',  color: '#23a55a' };
const OFFLINE = { label: 'Offline', color: '#747f8d' };

function Avatar({ name, size = 64 }) {
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
 * UserPopout — shows near the clicked element.
 * Props:
 *   userId   string
 *   username string
 *   anchorRect DOMRect  (getBoundingClientRect() of the trigger)
 *   onClose  () => void
 */
export default function UserPopout({ userId, username, anchorRect, onClose }) {
  const [user, setUser] = useState(null);
  const popoutRef = useRef(null);

  // Fetch full user (includes isOnline) on mount
  useEffect(() => {
    getAccountById(userId).then(setUser).catch(() => setUser(null));
  }, [userId]);

  // Close on Escape or outside click
  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose(); }
    function onDown(e) {
      if (popoutRef.current && !popoutRef.current.contains(e.target)) onClose();
    }
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
    };
  }, [onClose]);

  // Position: to the right of the anchor, clamped to viewport
  const POPOUT_W = 260;
  const POPOUT_H = 180;
  const GAP = 8;

  let left = anchorRect.right + GAP;
  let top  = anchorRect.top;

  // Flip left if no room on right
  if (left + POPOUT_W > window.innerWidth - 8) {
    left = anchorRect.left - POPOUT_W - GAP;
  }
  // Clamp vertical
  if (top + POPOUT_H > window.innerHeight - 8) {
    top = window.innerHeight - POPOUT_H - 8;
  }
  if (top < 8) top = 8;

  const sm = user ? (user.isOnline ? ONLINE : OFFLINE) : null;
  const displayName = user?.username ?? username;

  return (
    <div
      ref={popoutRef}
      style={{
        position: 'fixed', zIndex: 600,
        top, left,
        width: POPOUT_W,
        background: '#1e1f22',
        border: '1px solid #3b3d43',
        borderRadius: '10px',
        boxShadow: '0 12px 40px rgba(0,0,0,0.6)',
        overflow: 'hidden',
        userSelect: 'none',
      }}
    >
      {/* Coloured banner */}
      <div style={{
        height: 52,
        background: `hsl(${displayName ? (displayName.charCodeAt(0) * 37 + displayName.charCodeAt(displayName.length - 1) * 17) % 360 : 200},35%,22%)`,
      }} />

      {/* Avatar overlapping the banner */}
      <div style={{ position: 'relative', padding: '0 1rem' }}>
        <div style={{
          position: 'absolute', top: -32,
          background: '#1e1f22', borderRadius: '50%',
          padding: 3,
          // Status ring
          outline: sm ? `3px solid ${sm.color}` : 'none',
          outlineOffset: 1,
        }}>
          <Avatar name={displayName} size={56} />
        </div>
      </div>

      {/* Content */}
      <div style={{ padding: '2rem 1rem 1rem' }}>
        {/* Name */}
        <div style={{ fontWeight: 800, fontSize: '1rem', color: '#f2f3f5', marginBottom: '0.2rem' }}>
          {displayName}
        </div>

        {/* Status */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.75rem' }}>
          <div style={{
            width: 9, height: 9, borderRadius: '50%',
            background: sm?.color ?? '#747f8d',
            flexShrink: 0,
          }} />
          <span style={{ fontSize: '0.78rem', color: sm?.color ?? '#747f8d', fontWeight: 600 }}>
            {sm?.label ?? '…'}
          </span>
        </div>

        {/* Divider */}
        <div style={{ height: 1, background: '#3b3d43', margin: '0 0 0.65rem' }} />

        {/* User ID */}
        <div style={{ fontSize: '0.68rem', fontWeight: 700, color: '#72767d', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: '0.25rem' }}>
          User ID
        </div>
        <div
          title="Click to copy"
          onClick={() => navigator.clipboard?.writeText(userId)}
          style={{
            fontSize: '0.78rem', color: '#b5bac1', fontFamily: 'monospace',
            cursor: 'pointer', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            padding: '0.25rem 0.4rem', background: '#111214', borderRadius: '4px',
            transition: 'background 0.1s',
          }}
          onMouseEnter={e => e.currentTarget.style.background = '#2b2d31'}
          onMouseLeave={e => e.currentTarget.style.background = '#111214'}
        >
          {userId}
        </div>
      </div>
    </div>
  );
}