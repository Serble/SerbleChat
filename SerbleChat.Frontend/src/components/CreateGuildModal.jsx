import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { createGuild } from '../api.js';
import { useApp } from '../context/AppContext.jsx';

export default function CreateGuildModal({ onClose, onCreated }) {
  const { reconnectHub, setActiveGuildId } = useApp();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const backdropRef = useRef(null);
  const nav = useNavigate();

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function handleCreate(e) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const guild = await createGuild(name.trim());
      await onCreated?.();
      await reconnectHub();
      setActiveGuildId(String(guild.id));
      onClose();
      nav(`/app/guild/${guild.id}`);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <div
      ref={backdropRef}
      onClick={e => { if (e.target === backdropRef.current) onClose(); }}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(0,0,0,0.75)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '1rem',
      }}
    >
      <div style={{
        background: '#313338', borderRadius: '12px',
        width: '100%', maxWidth: 460,
        boxShadow: '0 16px 48px rgba(0,0,0,0.6)',
        overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{ padding: '1.5rem 1.5rem 0', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: '1.15rem', color: '#f2f3f5' }}>Create a Guild</div>
            <div style={{ fontSize: '0.82rem', color: '#72767d', marginTop: '0.25rem' }}>
              Your guild is where you and your friends hang out. Give it a name and start chatting.
            </div>
          </div>
          <button
            onClick={onClose}
            style={{ background: 'transparent', border: 'none', color: '#72767d', fontSize: '1.25rem', cursor: 'pointer', lineHeight: 1, padding: '0.2rem', borderRadius: '4px', flexShrink: 0, marginLeft: '1rem', transition: 'color 0.15s' }}
            onMouseEnter={e => e.currentTarget.style.color = '#f2f3f5'}
            onMouseLeave={e => e.currentTarget.style.color = '#72767d'}
          >✕</button>
        </div>

        <form onSubmit={handleCreate} style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          <div>
            <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 700, color: '#72767d', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: '0.4rem' }}>
              Guild Name
            </label>
            <input
              autoFocus
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="My Awesome Guild"
              maxLength={64}
              style={{
                width: '100%', background: '#1e1f22', border: '1px solid #3b3d43',
                borderRadius: '6px', padding: '0.65rem 0.75rem', color: '#f2f3f5',
                fontSize: '0.9rem', outline: 'none', transition: 'border-color 0.15s',
                boxSizing: 'border-box',
              }}
              onFocus={e => e.target.style.borderColor = '#7c3aed'}
              onBlur={e => e.target.style.borderColor = '#3b3d43'}
            />
          </div>

          {error && (
            <div style={{ background: 'rgba(242,63,67,0.1)', border: '1px solid rgba(242,63,67,0.3)', borderRadius: '6px', padding: '0.6rem 0.75rem', color: '#f23f43', fontSize: '0.83rem' }}>
              {error}
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
            <button
              type="button"
              onClick={onClose}
              style={{ background: 'transparent', border: 'none', color: '#72767d', cursor: 'pointer', padding: '0.55rem 1.1rem', borderRadius: '6px', fontSize: '0.875rem', fontWeight: 600, transition: 'color 0.15s' }}
              onMouseEnter={e => e.currentTarget.style.color = '#dbdee1'}
              onMouseLeave={e => e.currentTarget.style.color = '#72767d'}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy || !name.trim()}
              style={{ background: '#7c3aed', border: 'none', borderRadius: '6px', padding: '0.55rem 1.25rem', color: '#fff', fontSize: '0.875rem', fontWeight: 600, cursor: busy || !name.trim() ? 'default' : 'pointer', opacity: busy || !name.trim() ? 0.6 : 1, transition: 'background 0.15s, opacity 0.15s' }}
              onMouseEnter={e => { if (!busy && name.trim()) e.currentTarget.style.background = '#6d28d9'; }}
              onMouseLeave={e => e.currentTarget.style.background = '#7c3aed'}
            >
              {busy ? 'Creating…' : 'Create Guild'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
