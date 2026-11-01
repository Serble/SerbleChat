import { useState, useRef, useEffect } from 'react';
import { HammerIcon, LockIcon, ClockIcon } from '../icons.jsx';
import { Modal, ModalBody, ModalFooter, Button, TextInput, ErrorBox, Field, Segmented } from './ui/index.js';
import { useDateFormat } from '../dateFormat.js';

const MAX_DAYS = 36500;

const BAN_TYPES = [
  { value: 'permanent', label: 'Permanent', icon: LockIcon },
  { value: 'temporary', label: 'Temporary', icon: ClockIcon },
];

const DURATIONS = [
  { value: '1',      label: '1 day' },
  { value: '7',      label: '7 days' },
  { value: '30',     label: '30 days' },
  { value: 'custom', label: 'Custom' },
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
  const { formatDate } = useDateFormat();
  const [banType, setBanType]   = useState('permanent');
  const [duration, setDuration] = useState('7');      // a DURATIONS value
  const [customDays, setCustomDays] = useState('14');
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

  const days = parseInt(duration === 'custom' ? customDays : duration, 10);
  const daysValid = Number.isFinite(days) && days > 0 && days <= MAX_DAYS;
  const until = banType === 'temporary' && daysValid ? new Date(Date.now() + days * 24 * 60 * 60 * 1000) : null;

  function handleBan() {
    if (isBusy || submittingRef.current) return;
    setError(null);

    if (banType === 'temporary' && !daysValid) {
      setError(days > MAX_DAYS ? 'Ban duration cannot exceed 100 years.' : 'Please enter a valid number of days.');
      return;
    }

    const result = onBan(banType === 'permanent' ? new Date('9999-12-31T23:59:59Z') : until);
    if (result && typeof result.then === 'function') {
      submittingRef.current = true;
      setSubmitting(true);
      const done = () => { submittingRef.current = false; setSubmitting(false); };
      result.then(done, done);
    }
  }

  const who = <strong style={{ color: 'var(--text-primary)' }}>{username}</strong>;

  return (
    <Modal onClose={() => { if (!isBusy) onCancel(); }} title="Ban User" subtitle={username} icon={HammerIcon} width={440}>
      {/* Stop mousedown here so a parent's document-level click-outside handler
          (e.g. UserPopout, which renders this modal) doesn't close the parent —
          and with it this modal — when the user clicks inside the dialog. */}
      <div onMouseDown={e => e.stopPropagation()} style={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: '1 1 auto' }}>
        <ModalBody>
          <Field label="Duration">
            <Segmented fill options={BAN_TYPES} value={banType} disabled={isBusy}
              onChange={v => { setBanType(v); setError(null); }} />
          </Field>

          {banType === 'temporary' && (
            <Field label="Ban For">
              <Segmented fill size="sm" options={DURATIONS} value={duration} disabled={isBusy}
                onChange={v => { setDuration(v); setError(null); }} />
              {duration === 'custom' && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.6rem' }}>
                  <TextInput
                    autoFocus
                    type="number"
                    min="1"
                    max={MAX_DAYS}
                    value={customDays}
                    onChange={e => { setCustomDays(e.target.value); setError(null); }}
                    disabled={isBusy}
                    aria-label="Number of days"
                    style={{ width: 110 }}
                  />
                  <span className="ui-hint">days</span>
                </div>
              )}
            </Field>
          )}

          <div style={{
            padding: '0.7rem 0.85rem', borderRadius: 6, fontSize: '0.85rem', lineHeight: 1.5,
            background: 'var(--danger-soft)', border: '1px solid var(--danger-border)', color: 'var(--text-secondary)',
          }}>
            {banType === 'permanent'
              ? <>{who} will be removed from the guild and won't be able to rejoin unless they're unbanned.</>
              : until
                ? <>{who} will be removed from the guild and can rejoin after <strong style={{ color: 'var(--text-primary)' }}>{formatDate(until)}</strong>.</>
                : <>Enter a ban length between 1 and {MAX_DAYS.toLocaleString()} days.</>}
          </div>

          <ErrorBox>{error}</ErrorBox>
        </ModalBody>

        <ModalFooter>
          <Button variant="ghost" onClick={onCancel} disabled={isBusy}>Cancel</Button>
          <Button variant="danger-solid" onClick={handleBan} disabled={isBusy}>
            <HammerIcon size={14} /> {isBusy ? 'Banning…' : 'Ban User'}
          </Button>
        </ModalFooter>
      </div>
    </Modal>
  );
}
