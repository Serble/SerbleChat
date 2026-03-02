import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';

/**
 * BanModal
 * Modal for entering ban information (duration)
 * 
 * Props:
 * - username: string - The user being banned
 * - onBan: function(until: Date) - Called when user confirms ban
 * - onCancel: function - Called when user cancels
 * - busy: boolean - Whether a ban is in progress
 */
export default function BanModal({ username, onBan, onCancel, busy }) {
  const [banType, setBanType] = useState('permanent'); // 'permanent' or 'duration'
  const [days, setDays] = useState('7');
  const [error, setError] = useState(null);
  const backdropRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape' && !busy) onCancel();
      if (e.key === 'Enter' && !busy) handleBan();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [banType, days, busy, onCancel]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (banType === 'duration') {
      inputRef.current?.focus();
    }
  }, [banType]);

  function handleBan() {
    if (busy) return;
    setError(null);

    let until = new Date('9999-12-31T23:59:59Z'); // Permanent ban by default

    if (banType === 'duration') {
      const daysNum = parseInt(days);
      if (isNaN(daysNum) || daysNum <= 0) {
        setError('Please enter a valid number of days');
        return;
      }
      if (daysNum > 36500) {
        setError('Ban duration cannot exceed 100 years');
        return;
      }
      until = new Date();
      until.setDate(until.getDate() + daysNum);
    }

    onBan(until);
  }

  return createPortal(
    <div
      ref={backdropRef}
      onClick={e => {
        if (e.target === backdropRef.current && !busy) onCancel();
      }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        background: 'rgba(0,0,0,0.75)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '1rem',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: 'var(--bg-base)',
          borderRadius: '12px',
          width: '100%',
          maxWidth: 400,
          boxShadow: '0 16px 48px rgba(0,0,0,0.6)',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div style={{ padding: '1.25rem 1.5rem 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontWeight: 800, fontSize: '1.1rem', color: 'var(--text-primary)' }}>
            🔨 Ban User
          </div>
          <button
            onClick={onCancel}
            disabled={busy}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--text-muted)',
              fontSize: '1.25rem',
              cursor: busy ? 'default' : 'pointer',
              lineHeight: 1,
              padding: '0.2rem',
              borderRadius: '4px',
              transition: 'color 0.15s',
              opacity: busy ? 0.5 : 1,
            }}
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: '1.25rem 1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {/* Username */}
          <div>
            <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: '0.4rem' }}>
              User
            </div>
            <div
              style={{
                padding: '0.65rem 0.75rem',
                background: 'var(--bg-secondary)',
                border: '1px solid var(--border)',
                borderRadius: '6px',
                color: 'var(--text-primary)',
                fontSize: '0.9rem',
                fontWeight: 600,
              }}
            >
              {username}
            </div>
          </div>

          {/* Ban Type Selection */}
          <div>
            <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: '0.4rem' }}>
              Ban Duration
            </div>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              {['permanent', 'duration'].map(type => (
                <button
                  key={type}
                  onClick={() => setBanType(type)}
                  disabled={busy}
                  style={{
                    flex: 1,
                    padding: '0.65rem 0.75rem',
                    border: `1px solid ${banType === type ? 'var(--accent)' : 'var(--border)'}`,
                    background: banType === type ? 'rgba(124,58,237,0.15)' : 'var(--bg-secondary)',
                    borderRadius: '6px',
                    color: banType === type ? 'var(--text-primary)' : 'var(--text-secondary)',
                    fontSize: '0.875rem',
                    fontWeight: banType === type ? 600 : 500,
                    cursor: busy ? 'default' : 'pointer',
                    opacity: busy ? 0.5 : 1,
                    transition: 'all 0.15s',
                  }}
                >
                  {type === 'permanent' ? '🔒 Permanent' : '⏰ Temporary'}
                </button>
              ))}
            </div>
          </div>

          {/* Duration Input */}
          {banType === 'duration' && (
            <div>
              <label
                style={{
                  fontSize: '0.72rem',
                  fontWeight: 700,
                  color: 'var(--text-muted)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.07em',
                  marginBottom: '0.4rem',
                  display: 'block',
                }}
              >
                Number of Days
              </label>
              <input
                ref={inputRef}
                type="number"
                min="1"
                max="36500"
                value={days}
                onChange={e => {
                  setDays(e.target.value);
                  setError(null);
                }}
                disabled={busy}
                placeholder="e.g. 7"
                style={{
                  width: '100%',
                  padding: '0.65rem 0.75rem',
                  background: 'var(--bg-secondary)',
                  border: '1px solid var(--border)',
                  borderRadius: '6px',
                  color: 'var(--text-primary)',
                  fontSize: '0.9rem',
                  outline: 'none',
                  boxSizing: 'border-box',
                  transition: 'border-color 0.15s',
                  opacity: busy ? 0.5 : 1,
                  cursor: busy ? 'default' : 'text',
                }}
                onFocus={e => (e.target.style.borderColor = 'var(--accent)')}
                onBlur={e => (e.target.style.borderColor = 'var(--border)')}
              />
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                Maximum: 36,500 days (100 years)
              </div>
            </div>
          )}

          {/* Error Message */}
          {error && (
            <div
              style={{
                background: 'rgba(242,63,67,0.1)',
                border: '1px solid rgba(242,63,67,0.3)',
                borderRadius: '6px',
                padding: '0.5rem 0.75rem',
                color: 'var(--danger)',
                fontSize: '0.83rem',
              }}
            >
              {error}
            </div>
          )}

          {/* Summary */}
          <div
            style={{
              background: 'var(--bg-secondary)',
              borderRadius: '6px',
              padding: '0.75rem 0.75rem',
              fontSize: '0.82rem',
              color: 'var(--text-secondary)',
              lineHeight: 1.5,
            }}
          >
            {banType === 'permanent' ? (
              <>
                <strong>Permanent ban</strong>
                <br />
                This user will not be able to join unless manually unbanned.
              </>
            ) : (
              <>
                <strong>Temporary ban until:</strong>
                <br />
                {days && !isNaN(days) && parseInt(days) > 0
                  ? new Date(Date.now() + parseInt(days) * 24 * 60 * 60 * 1000).toLocaleDateString()
                  : 'Invalid duration'}
              </>
            )}
          </div>
        </div>

        {/* Footer */}
        <div style={{ padding: '0 1.5rem 1.25rem', display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
          <button
            onClick={onCancel}
            disabled={busy}
            style={{
              background: 'transparent',
              border: '1px solid var(--border)',
              borderRadius: '6px',
              padding: '0.55rem 1rem',
              color: 'var(--text-secondary)',
              fontSize: '0.875rem',
              fontWeight: 600,
              cursor: busy ? 'default' : 'pointer',
              opacity: busy ? 0.5 : 1,
              transition: 'all 0.15s',
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleBan}
            disabled={busy}
            style={{
              background: 'var(--danger)',
              border: 'none',
              borderRadius: '6px',
              padding: '0.55rem 1.1rem',
              color: '#fff',
              fontSize: '0.875rem',
              fontWeight: 600,
              cursor: busy ? 'default' : 'pointer',
              opacity: busy ? 0.6 : 1,
              transition: 'all 0.15s',
            }}
          >
            {busy ? 'Banning…' : 'Ban User'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
