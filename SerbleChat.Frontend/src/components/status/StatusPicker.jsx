import { useState } from 'react';
import { useApp } from '../../context/AppContext.jsx';
import { ContextMenu, MenuDivider, Modal, ModalBody, ModalFooter, Button, TextInput, Select, Field, ErrorBox, Segmented } from '../ui/index.js';
import { CheckIcon, EditIcon, CloseIcon } from '../../icons.jsx';
import StatusDot from './StatusDot.jsx';
import { useDateFormat } from '../../dateFormat.js';
import {
  STATUS_META, STATUS_TYPES, DURATIONS, MAX_STATUS_MESSAGE, formatUntil, expiresAtMs,
  DURATION_UNITS, MAX_CUSTOM_MS, toLocalInputValue, formatRelative, formatClearTime,
} from './status.js';

/**
 * Quick status menu, opened from your own profile card or by right-clicking the
 * user panel. Picking a type keeps your message (and its expiry). Without a message
 * the expiry belonged to the old type, so the new one lasts until you change it.
 * `children` are extra items added at the end, after a divider.
 */
export function StatusMenu({ x, y, onClose, onCustom, label, children }) {
  const { ownStatus, setOwnStatus, clearOwnStatus, addToast } = useApp();
  const hasCustom = !!ownStatus.message || ownStatus.type !== 'online';

  async function pick(type) {
    onClose();
    if (type === ownStatus.type) return;
    try {
      await setOwnStatus({
        type,
        message: ownStatus.message,
        expiresAt: ownStatus.message ? ownStatus.expiresAt : null,
      });
    } catch (e) {
      addToast({ title: "Couldn't change status", body: e?.message || 'Please try again.', type: 'error' });
    }
  }

  async function clear() {
    onClose();
    try { await clearOwnStatus(); }
    catch (e) { addToast({ title: "Couldn't clear status", body: e?.message || 'Please try again.', type: 'error' }); }
  }

  return (
    <ContextMenu x={x} y={y} onClose={onClose} minWidth={240} zIndex={9500}>
      {label && <div className="ui-menu-label">{label}</div>}
      {STATUS_TYPES.map(type => {
        const meta = STATUS_META[type];
        const current = type === ownStatus.type;
        return (
          <button
            key={type}
            type="button"
            role="menuitemradio"
            aria-checked={current}
            className="ui-menu-item"
            onClick={() => pick(type)}
            style={{ alignItems: meta.description ? 'flex-start' : 'center' }}
          >
            <span className="ui-menu-icon" style={{ paddingTop: meta.description ? '0.2rem' : 0 }}>
              <StatusDot presence={type} size={10} title="" />
            </span>
            <span style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
              <span style={{ display: 'block' }}>{meta.label}</span>
              {meta.description && (
                <span style={{ display: 'block', fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.1rem' }}>
                  {meta.description}
                </span>
              )}
            </span>
            {current && <CheckIcon size={13} style={{ color: 'var(--accent)', flexShrink: 0 }} />}
          </button>
        );
      })}
      <MenuDivider />
      <button type="button" role="menuitem" className="ui-menu-item" onClick={() => { onClose(); onCustom(); }}>
        <span className="ui-menu-icon"><EditIcon size={14} /></span>
        {ownStatus.message ? 'Edit custom status' : 'Set a custom status'}
      </button>
      {hasCustom && (
        <button type="button" role="menuitem" className="ui-menu-item" data-variant="danger" onClick={clear}>
          <span className="ui-menu-icon"><CloseIcon size={14} /></span>
          Clear status
        </button>
      )}
      {children && <MenuDivider />}
      {children}
    </ContextMenu>
  );
}

/** Pick a type, an optional message and when it clears. */
export function CustomStatusModal({ onClose }) {
  const { ownStatus, setOwnStatus, clearOwnStatus } = useApp();
  const [type, setType] = useState(ownStatus.type);
  const [message, setMessage] = useState(ownStatus.message);
  // An existing expiry can be kept as is; otherwise default to never
  const [clearAfter, setClearAfter] = useState(() => initialClearAfter(ownStatus.expiresAt));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const hasCurrent = !!ownStatus.message || ownStatus.type !== 'online';
  const clearAt = resolveClearAfter(clearAfter, ownStatus.expiresAt, Date.now());

  async function save() {
    // Resolved again at save time, so "1 hour" counts from now rather than from when the modal opened
    const { expiresAt, error: clearError } = resolveClearAfter(clearAfter, ownStatus.expiresAt, Date.now());
    if (clearError) return;
    setBusy(true);
    setError('');
    try {
      await setOwnStatus({ type, message: message.trim(), expiresAt });
      onClose();
    } catch (e) {
      setError(e?.message || "Couldn't save your status");
      setBusy(false);
    }
  }

  async function clear() {
    setBusy(true);
    setError('');
    try {
      await clearOwnStatus();
      onClose();
    } catch (e) {
      setError(e?.message || "Couldn't clear your status");
      setBusy(false);
    }
  }

  return (
    <Modal title="Set your status" onClose={onClose} onSubmit={save} width={440}>
      <ModalBody style={{ display: 'flex', flexDirection: 'column', gap: '1.1rem' }}>
        <Field
          label="Message"
          htmlFor="status-message"
          hint={`${message.length}/${MAX_STATUS_MESSAGE} · Shown under your name, even while you're offline.`}
        >
          <TextInput
            id="status-message"
            autoFocus
            value={message}
            maxLength={MAX_STATUS_MESSAGE}
            placeholder="What's happening?"
            onChange={e => setMessage(e.target.value.replace(/[\r\n]+/g, ' '))}
            style={{ width: '100%' }}
          />
        </Field>

        <div>
          <div style={{
            fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase',
            letterSpacing: '0.07em', marginBottom: '0.4rem',
          }}>Status</div>
          <div role="radiogroup" aria-label="Status" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '0.4rem' }}>
            {STATUS_TYPES.map(t => {
              const selected = t === type;
              return (
                <button
                  key={t}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => setType(t)}
                  className={selected ? undefined : 'hov-bg'}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '0.5rem',
                    padding: '0.5rem 0.65rem', borderRadius: 6, cursor: 'pointer',
                    font: 'inherit', fontSize: '0.84rem', textAlign: 'left',
                    color: selected ? 'var(--text-primary)' : 'var(--text-secondary)',
                    background: selected ? 'var(--bg-active)' : 'var(--bg-secondary)',
                    border: `1px solid ${selected ? 'var(--accent)' : 'var(--border)'}`,
                  }}
                >
                  <StatusDot presence={t} size={10} title="" />
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{STATUS_META[t].label}</span>
                </button>
              );
            })}
          </div>
          {STATUS_META[type].description && (
            <div className="ui-hint" style={{ marginTop: '0.4rem' }}>{STATUS_META[type].description}.</div>
          )}
        </div>

        <ClearAfterField
          value={clearAfter}
          onChange={patch => setClearAfter(v => ({ ...v, ...patch }))}
          currentExpiresAt={ownStatus.expiresAt}
          resolved={clearAt}
        />

        <ErrorBox>{error}</ErrorBox>
      </ModalBody>
      <ModalFooter left={hasCurrent && (
        <Button variant="danger-outline" onClick={clear} disabled={busy}>Clear status</Button>
      )}>
        <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button variant="primary" type="submit" disabled={busy || !!clearAt.error}>{busy ? 'Saving…' : 'Save'}</Button>
      </ModalFooter>
    </Modal>
  );
}

// ── Clear after ───────────────────────────────────────────────────────────────

/**
 * State of the "Clear after" field:
 *   choice: 'keep' | a DURATIONS key | 'custom'
 *   mode:   'duration' | 'time' (custom only)
 *   amount + unit for a custom duration, `at` (datetime-local value) for a custom time.
 * Both custom inputs keep their values when you switch between them.
 */
function initialClearAfter(currentExpiresAt) {
  // Custom time starts at the current expiry if there is one, so it can be nudged;
  // otherwise an hour from now, rounded up to the next quarter hour
  const current = expiresAtMs(currentExpiresAt);
  let at;
  if (current != null) {
    at = new Date(current);
  } else {
    at = new Date(Date.now() + 60 * 60 * 1000);
    at.setMinutes(Math.ceil(at.getMinutes() / 15) * 15, 0, 0);
  }
  return {
    choice: currentExpiresAt ? 'keep' : 'never',
    mode: 'duration',
    amount: '2',
    unit: 'hours',
    at: toLocalInputValue(at),
  };
}

/** Turns the field's state into { expiresAt: Date | null, error }. */
function resolveClearAfter(v, currentExpiresAt, now) {
  if (v.choice === 'keep') {
    const t = expiresAtMs(currentExpiresAt);
    return { expiresAt: t != null ? new Date(t) : null, error: '' };
  }
  if (v.choice !== 'custom') {
    return { expiresAt: DURATIONS.find(d => d.key === v.choice).at(now), error: '' };
  }
  if (v.mode === 'duration') {
    const amount = Number(v.amount);
    const unit = DURATION_UNITS.find(u => u.key === v.unit);
    if (v.amount === '' || !Number.isFinite(amount) || amount <= 0) return { expiresAt: null, error: 'Enter how long it should last.' };
    const ms = amount * unit.ms;
    if (ms < 60 * 1000) return { expiresAt: null, error: 'It needs to last at least a minute.' };
    if (ms > MAX_CUSTOM_MS) return { expiresAt: null, error: "That's over a year. Use \u201cDon't clear\u201d instead." };
    return { expiresAt: new Date(now + ms), error: '' };
  }
  const at = v.at ? new Date(v.at) : null;  // datetime-local values parse as local time
  if (!at || Number.isNaN(at.getTime())) return { expiresAt: null, error: 'Pick a date and time.' };
  if (at.getTime() <= now + 30 * 1000) return { expiresAt: null, error: 'Pick a time in the future.' };
  if (at.getTime() - now > MAX_CUSTOM_MS) return { expiresAt: null, error: "That's over a year away. Use \u201cDon't clear\u201d instead." };
  return { expiresAt: at, error: '' };
}

const CUSTOM_MODES = [
  { value: 'duration', label: 'For a duration' },
  { value: 'time',     label: 'Until a time' },
];

/** Native date pickers draw their own icons; match them to the theme's input background. */
function inputColorScheme() {
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--bg-input').trim();
  let rgb = null;
  const hex = raw.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hex) {
    const h = hex[1].length === 3 ? [...hex[1]].map(c => c + c).join('') : hex[1];
    rgb = [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16));
  } else {
    const m = raw.match(/rgba?\(([^)]+)\)/);
    if (m) rgb = m[1].split(',').slice(0, 3).map(Number);
  }
  if (!rgb) return 'dark';
  const luminance = (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]) / 255;
  return luminance < 0.5 ? 'dark' : 'light';
}

/**
 * Presets in a dropdown, with "Custom…" opening a duration or date/time picker.
 * A line underneath always says exactly when the status will clear.
 */
function ClearAfterField({ value, onChange, currentExpiresAt, resolved }) {
  useDateFormat();  // re-render when the format settings change
  const now = Date.now();
  const custom = value.choice === 'custom';

  let summary;
  if (resolved.error) summary = resolved.error;
  else if (!resolved.expiresAt) summary = 'Stays until you change it.';
  else summary = `Clears ${formatClearTime(resolved.expiresAt, now)} (${formatRelative(resolved.expiresAt.getTime() - now)}).`;

  return (
    <div>
      <label htmlFor="status-duration" style={{
        display: 'block', fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)',
        textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: '0.4rem',
      }}>Clear after</label>
      <Select id="status-duration" value={value.choice} onChange={e => onChange({ choice: e.target.value })}>
        {currentExpiresAt && <option value="keep">Keep current ({formatUntil(currentExpiresAt)})</option>}
        {DURATIONS.map(d => <option key={d.key} value={d.key}>{d.label}</option>)}
        <option value="custom">Custom…</option>
      </Select>

      {custom && (
        <div style={{
          marginTop: '0.5rem', padding: '0.65rem', borderRadius: 6,
          background: 'var(--bg-secondary)', border: '1px solid var(--border)',
          display: 'flex', flexDirection: 'column', gap: '0.55rem',
        }}>
          <Segmented fill size="sm" options={CUSTOM_MODES} value={value.mode} onChange={mode => onChange({ mode })} aria-label="Custom clear time" />
          {value.mode === 'duration' ? (
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <TextInput
                id="status-duration-amount"
                type="number"
                min="1"
                step="any"
                inputMode="decimal"
                aria-label="How long"
                value={value.amount}
                onChange={e => onChange({ amount: e.target.value })}
                style={{ width: 96, flexShrink: 0 }}
              />
              <Select aria-label="Unit" value={value.unit} onChange={e => onChange({ unit: e.target.value })}>
                {DURATION_UNITS.map(u => <option key={u.key} value={u.key}>{u.label}</option>)}
              </Select>
            </div>
          ) : (
            <TextInput
              id="status-clear-at"
              type="datetime-local"
              aria-label="Clear at"
              value={value.at}
              min={toLocalInputValue(new Date(now))}
              onChange={e => onChange({ at: e.target.value })}
              style={{ colorScheme: inputColorScheme() }}
            />
          )}
        </div>
      )}

      <div className="ui-hint" role={resolved.error ? 'alert' : undefined} style={{
        marginTop: '0.4rem', color: resolved.error ? 'var(--danger)' : undefined,
      }}>
        {summary}
      </div>
    </div>
  );
}
