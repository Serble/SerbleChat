import { useState, useRef, useEffect } from 'react';
import { HammerIcon, LockIcon, ClockIcon } from '../icons.jsx';
import { Modal, Button, TextInput, ErrorBox, Hint } from './ui/index.js';
import { FieldLabel } from './ui/index.js';

const BAN_TYPES = [
  { value: 'permanent', label: 'Permanent', icon: LockIcon },
  { value: 'duration',  label: 'Temporary', icon: ClockIcon },
];

/**
 * BanModal
 * Modal for entering ban information (duration)
 *
 * Props:
 * - username: string - The user being banned
 * - onBan: function(until: Date) - Called when user confirms ban (may return a promise)
 * - onCancel: function - Called when user cancels
 * - busy: boolean - Whether a ban is in progress
 */
export default function BanModal({ username, onBan, onCancel, busy }) {
  const [banType, setBanType] = useState('permanent'); // 'permanent' or 'duration'
  const [days, setDays] = useState('7');
  const [error, setError] = useState(null);
  // Tracks an in-flight onBan promise so the ban can't be submitted twice even
  // when the caller doesn't pass `busy`.
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const isBusy = busy || submitting;

  // Enter confirms from anywhere in the modal — except on a focused button,
  // where Enter already activates that button (Cancel, a ban type, or Ban itself).
  const handleBanRef = useRef(null);
  handleBanRef.current = handleBan;
  useEffect(() => {
    function onKey(e) {
      if (e.key !== 'Enter' || e.target instanceof HTMLButtonElement) return;
      e.preventDefault();
      handleBanRef.current();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  function handleBan() {
    if (isBusy || submittingRef.current) return;
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

    const result = onBan(until);
    if (result && typeof result.then === 'function') {
      submittingRef.current = true;
      setSubmitting(true);
      const done = () => { submittingRef.current = false; setSubmitting(false); };
      result.then(done, done);
    }
  }

  const daysNum = parseInt(days);

  return (
    <Modal onClose={() => { if (!isBusy) onCancel(); }} title="Ban User" icon={HammerIcon} width={400}>
      {/* Stop mousedown here so a parent's document-level click-outside handler
          (e.g. UserPopout, which renders this modal) doesn't close the parent —
          and with it this modal — when the user clicks inside the dialog. */}
      <div onMouseDown={e => e.stopPropagation()} style={{ display: 'flex', flexDirection: 'column', minHeight: 0, overflowY: 'auto' }}>
        {/* Body */}
        <div style={{ padding: '1.25rem 1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {/* Username */}
          <div>
            <FieldLabel>User</FieldLabel>
            <div style={{
              padding: '0.65rem 0.75rem',
              background: 'var(--bg-secondary)',
              border: '1px solid var(--border)',
              borderRadius: '6px',
              color: 'var(--text-primary)',
              fontSize: '0.9rem',
              fontWeight: 600,
            }}>
              {username}
            </div>
          </div>

          {/* Ban Type Selection */}
          <div>
            <FieldLabel>Ban Duration</FieldLabel>
            <div role="radiogroup" style={{ display: 'flex', gap: '0.5rem' }}>
              {BAN_TYPES.map(({ value, label, icon: Icon }) => {
                const isSel = banType === value;
                return (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={isSel}
                    onClick={() => { setBanType(value); setError(null); }}
                    disabled={isBusy}
                    className={isSel || isBusy ? undefined : 'hov-bg'}
                    style={{
                      flex: 1,
                      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.35rem',
                      padding: '0.65rem 0.75rem',
                      border: `1px solid ${isSel ? 'var(--accent)' : 'var(--border)'}`,
                      background: isSel ? 'var(--accent-soft)' : 'var(--bg-secondary)',
                      borderRadius: '6px',
                      color: isSel ? 'var(--text-primary)' : 'var(--text-secondary)',
                      font: 'inherit',
                      fontSize: '0.875rem',
                      fontWeight: isSel ? 600 : 500,
                      cursor: isBusy ? 'default' : 'pointer',
                      opacity: isBusy ? 0.5 : 1,
                      transition: 'all 0.15s',
                    }}
                  >
                    <Icon size={14} /> {label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Duration Input */}
          {banType === 'duration' && (
            <div>
              <FieldLabel htmlFor="ban-days">Number of Days</FieldLabel>
              <TextInput
                id="ban-days"
                autoFocus
                type="number"
                min="1"
                max="36500"
                value={days}
                onChange={e => {
                  setDays(e.target.value);
                  setError(null);
                }}
                disabled={isBusy}
                placeholder="e.g. 7"
              />
              <Hint style={{ fontSize: '0.72rem', marginTop: '0.25rem' }}>
                Maximum: 36,500 days (100 years)
              </Hint>
            </div>
          )}

          <ErrorBox>{error}</ErrorBox>

          {/* Summary */}
          <div style={{
            background: 'var(--bg-secondary)',
            borderRadius: '6px',
            padding: '0.75rem',
            fontSize: '0.82rem',
            color: 'var(--text-secondary)',
            lineHeight: 1.5,
          }}>
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
                {daysNum > 0
                  ? new Date(Date.now() + daysNum * 24 * 60 * 60 * 1000).toLocaleDateString()
                  : 'Invalid duration'}
              </>
            )}
          </div>
        </div>

        {/* Footer */}
        <div style={{ padding: '0 1.5rem 1.25rem', display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
          <Button variant="outline" onClick={onCancel} disabled={isBusy}>Cancel</Button>
          <Button
            variant="primary"
            onClick={handleBan}
            disabled={isBusy}
            style={{ background: 'var(--danger)', color: '#fff', opacity: isBusy ? 0.6 : 1 }}
          >
            {isBusy ? 'Banning…' : 'Ban User'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
