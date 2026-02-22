import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../context/AppContext.jsx';
import { createGroupChat } from '../api.js';

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

export default function CreateGroupModal({ onClose }) {
  const { friends, currentUser, resolveUser, refreshDms } = useApp();
  const nav = useNavigate();

  const [name, setName]         = useState('');
  const [selected, setSelected] = useState(new Set());
  const [userMap, setUserMap]   = useState({});
  const [busy, setBusy]         = useState(false);
  const [error, setError]       = useState(null);
  const backdropRef             = useRef(null);

  // Accepted friends only
  const acceptedFriends = friends.filter(f => !f.pending);

  // Resolve all friend usernames up front
  useEffect(() => {
    acceptedFriends.forEach(f => {
      const otherId = f.user1Id === currentUser?.id ? f.user2Id : f.user1Id;
      resolveUser(otherId).then(u => setUserMap(p => ({ ...p, [otherId]: u })));
    });
  }, [friends]); // eslint-disable-line react-hooks/exhaustive-deps

  function toggle(id) {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  async function handleCreate(e) {
    e.preventDefault();
    if (!name.trim()) { setError('Please enter a group name.'); return; }
    if (selected.size === 0) { setError('Select at least one friend.'); return; }
    setBusy(true);
    setError(null);
    try {
      const chat = await createGroupChat(name.trim(), [...selected]);
      await refreshDms();
      onClose();
      nav(`/app/channel/${chat.channelId}`);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  // Close on backdrop click
  function handleBackdrop(e) {
    if (e.target === backdropRef.current) onClose();
  }

  // Close on Escape
  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      ref={backdropRef}
      onClick={handleBackdrop}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(0,0,0,0.7)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '1rem',
      }}
    >
      <div style={{
        background: '#313338', borderRadius: '12px',
        width: '100%', maxWidth: 460,
        boxShadow: '0 16px 48px rgba(0,0,0,0.6)',
        display: 'flex', flexDirection: 'column',
        overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{
          padding: '1.25rem 1.5rem 0',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: '1.1rem', color: '#f2f3f5' }}>
              Create a Group Chat
            </div>
            <div style={{ fontSize: '0.8rem', color: '#72767d', marginTop: '0.2rem' }}>
              Give it a name and pick your friends.
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'transparent', border: 'none', color: '#72767d',
              fontSize: '1.25rem', cursor: 'pointer', lineHeight: 1,
              padding: '0.25rem', borderRadius: '4px',
              transition: 'color 0.15s',
            }}
            onMouseEnter={e => e.currentTarget.style.color = '#f2f3f5'}
            onMouseLeave={e => e.currentTarget.style.color = '#72767d'}
          >
            ✕
          </button>
        </div>

        <form onSubmit={handleCreate} style={{ padding: '1.25rem 1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {/* Group name */}
          <div>
            <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 700, color: '#72767d', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: '0.4rem' }}>
              Group Name
            </label>
            <input
              autoFocus
              style={{
                width: '100%', background: '#1e1f22', border: '1px solid #3b3d43',
                borderRadius: '6px', padding: '0.6rem 0.75rem', color: '#f2f3f5',
                fontSize: '0.9rem', outline: 'none', transition: 'border-color 0.15s',
              }}
              placeholder="My Awesome Group"
              value={name}
              onChange={e => setName(e.target.value)}
              maxLength={64}
              onFocus={e => e.target.style.borderColor = '#7c3aed'}
              onBlur={e => e.target.style.borderColor = '#3b3d43'}
            />
          </div>

          {/* Friend picker */}
          <div>
            <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 700, color: '#72767d', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: '0.4rem' }}>
              Add Friends {selected.size > 0 && <span style={{ color: '#a78bfa' }}>— {selected.size} selected</span>}
            </label>
            <div style={{
              background: '#1e1f22', border: '1px solid #3b3d43', borderRadius: '6px',
              maxHeight: 220, overflowY: 'auto',
            }}>
              {acceptedFriends.length === 0 && (
                <div style={{ padding: '1rem', color: '#4f5660', fontSize: '0.85rem', textAlign: 'center' }}>
                  You have no friends to add yet.
                </div>
              )}
              {acceptedFriends.map(f => {
                const otherId = f.user1Id === currentUser?.id ? f.user2Id : f.user1Id;
                const u = userMap[otherId];
                const isSelected = selected.has(otherId);
                return (
                  <div
                    key={f.id}
                    onClick={() => toggle(otherId)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '0.75rem',
                      padding: '0.55rem 0.75rem', cursor: 'pointer',
                      background: isSelected ? 'rgba(124,58,237,0.15)' : 'transparent',
                      transition: 'background 0.1s',
                    }}
                    onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = '#2b2d31'; }}
                    onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = 'transparent'; }}
                  >
                    <Avatar name={u?.username} size={32} />
                    <span style={{
                      flex: 1, color: '#dbdee1', fontSize: '0.875rem', fontWeight: isSelected ? 600 : 400,
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                      {u?.username ?? '…'}
                    </span>
                    {/* Checkbox */}
                    <div style={{
                      width: 20, height: 20, borderRadius: '50%', flexShrink: 0,
                      border: `2px solid ${isSelected ? '#7c3aed' : '#4f5660'}`,
                      background: isSelected ? '#7c3aed' : 'transparent',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      transition: 'background 0.15s, border-color 0.15s',
                    }}>
                      {isSelected && (
                        <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                          <path d="M2 5l2.5 2.5L8 3" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {error && (
            <div style={{
              padding: '0.6rem 0.75rem', borderRadius: '6px',
              background: 'rgba(237,66,69,0.15)', color: '#f23f43',
              fontSize: '0.82rem', border: '1px solid rgba(237,66,69,0.3)',
            }}>
              {error}
            </div>
          )}

          {/* Actions */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '0.25rem' }}>
            <button
              type="button"
              onClick={onClose}
              style={{
                padding: '0.6rem 1.25rem', borderRadius: '6px',
                background: 'transparent', border: 'none',
                color: '#949ba4', fontWeight: 600, fontSize: '0.875rem',
                cursor: 'pointer', transition: 'color 0.15s',
              }}
              onMouseEnter={e => e.currentTarget.style.color = '#f2f3f5'}
              onMouseLeave={e => e.currentTarget.style.color = '#949ba4'}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy || !name.trim() || selected.size === 0}
              style={{
                padding: '0.6rem 1.5rem', borderRadius: '6px',
                background: busy || !name.trim() || selected.size === 0 ? '#404249' : '#7c3aed',
                border: 'none', color: '#fff', fontWeight: 700, fontSize: '0.875rem',
                cursor: busy || !name.trim() || selected.size === 0 ? 'default' : 'pointer',
                transition: 'background 0.15s',
              }}
              onMouseEnter={e => { if (!busy && name.trim() && selected.size > 0) e.currentTarget.style.background = '#6d28d9'; }}
              onMouseLeave={e => { if (!busy && name.trim() && selected.size > 0) e.currentTarget.style.background = '#7c3aed'; }}
            >
              {busy ? 'Creating…' : 'Create Group'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
