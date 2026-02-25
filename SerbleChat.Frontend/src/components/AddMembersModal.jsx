import { useState, useEffect, useRef } from 'react';
import { useApp } from '../context/AppContext.jsx';
import { addGroupChatMembers } from '../api.js';

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

/** groupId: number, existingMemberIds: Set<string>, onClose: fn */
export default function AddMembersModal({ groupId, existingMemberIds, onClose }) {
  const { friends, currentUser, resolveUser } = useApp();
  const [selected, setSelected] = useState(new Set());
  const [userMap,  setUserMap]  = useState({});
  const [busy,     setBusy]     = useState(false);
  const [error,    setError]    = useState(null);
  const backdropRef = useRef(null);

  // Friends not already in the group
  const eligible = friends.filter(f => {
    if (f.pending) return false;
    const otherId = f.user1Id === currentUser?.id ? f.user2Id : f.user1Id;
    return !existingMemberIds.has(otherId);
  });

  useEffect(() => {
    eligible.forEach(f => {
      const otherId = f.user1Id === currentUser?.id ? f.user2Id : f.user1Id;
      resolveUser(otherId).then(u => setUserMap(p => ({ ...p, [otherId]: u })));
    });
  }, [friends]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  function toggle(id) {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  async function handleAdd(e) {
    e.preventDefault();
    if (selected.size === 0) { setError('Select at least one friend.'); return; }
    setBusy(true); setError(null);
    try {
      await addGroupChatMembers(groupId, [...selected]);
      onClose();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <div
      ref={backdropRef}
      onClick={e => { if (e.target === backdropRef.current) onClose(); }}
      style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}
    >
      <div style={{
        background: 'var(--bg-base)', borderRadius: '12px', width: '100%', maxWidth: 440,
        boxShadow: '0 16px 48px rgba(0,0,0,0.6)', overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{ padding: '1.25rem 1.5rem 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: '1.05rem', color: 'var(--text-primary)' }}>Add Members</div>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
              Pick friends to add to this group.
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', fontSize: '1.2rem', cursor: 'pointer', padding: '0.25rem', borderRadius: '4px', lineHeight: 1 }}
            className="hov-text-primary"
          >✕</button>
        </div>

        <form onSubmit={handleAdd} style={{ padding: '1.25rem 1.5rem', display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
          <div>
            <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: '0.4rem' }}>
              Friends {selected.size > 0 && <span style={{ color: 'var(--accent)' }}>— {selected.size} selected</span>}
            </label>
            <div style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border)', borderRadius: '6px', maxHeight: 240, overflowY: 'auto' }}>
              {eligible.length === 0 && (
                <div style={{ padding: '1rem', color: 'var(--text-subtle)', fontSize: '0.85rem', textAlign: 'center' }}>
                  All your friends are already in this group.
                </div>
              )}
              {eligible.map(f => {
                const otherId = f.user1Id === currentUser?.id ? f.user2Id : f.user1Id;
                const u = userMap[otherId];
                const isSel = selected.has(otherId);
                return (
                  <div
                    key={f.id}
                    onClick={() => toggle(otherId)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '0.75rem',
                      padding: '0.55rem 0.75rem', cursor: 'pointer',
                      background: isSel ? 'rgba(124,58,237,0.15)' : 'transparent',
                      transition: 'background 0.1s',
                    }}
                    className={!isSel ? 'hov-bg-secondary' : undefined}
                  >
                    <Avatar name={u?.username} size={32} />
                    <span style={{ flex: 1, color: 'var(--text-secondary)', fontSize: '0.875rem', fontWeight: isSel ? 600 : 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {u?.username ?? '…'}
                    </span>
                    <div style={{
                      width: 20, height: 20, borderRadius: '50%', flexShrink: 0,
                      border: `2px solid ${isSel ? 'var(--accent)' : 'var(--text-subtle)'}`,
                      background: isSel ? 'var(--accent)' : 'transparent',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      transition: 'all 0.15s',
                    }}>
                      {isSel && <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M2 5l2.5 2.5L8 3" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {error && (
            <div style={{ padding: '0.6rem 0.75rem', borderRadius: '6px', background: 'rgba(237,66,69,0.15)', color: 'var(--danger)', fontSize: '0.82rem', border: '1px solid rgba(237,66,69,0.3)' }}>
              {error}
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
            <button type="button" onClick={onClose}
              style={{ padding: '0.6rem 1.25rem', borderRadius: '6px', background: 'transparent', border: 'none', color: 'var(--text-muted)', fontWeight: 600, fontSize: '0.875rem', cursor: 'pointer' }}
              className="hov-text-primary"
            >Cancel</button>
            <button type="submit" disabled={busy || selected.size === 0}
              style={{
                padding: '0.6rem 1.5rem', borderRadius: '6px', border: 'none', fontWeight: 700, fontSize: '0.875rem',
                background: busy || selected.size === 0 ? 'var(--bg-active)' : 'var(--accent)',
                color: '#fff', cursor: busy || selected.size === 0 ? 'default' : 'pointer',
                transition: 'background 0.15s',
              }}
              className={!busy && selected.size > 0 ? 'hov-accent' : undefined}
            >{busy ? 'Adding…' : 'Add Members'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}