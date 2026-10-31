import { useRef, useState } from 'react';
import { Button, ErrorBox, Card, SettingRow, Toggle, FieldLabel, Field } from '../ui/index.js';
import { UploadIcon } from '../../icons.jsx';

// Small building blocks shared by the guild / channel modals.

/** Muted single-line text for loading / empty states. */
export function MutedText({ children, subtle, style }) {
  return (
    <div style={{ color: subtle ? 'var(--text-subtle)' : 'var(--text-muted)', fontSize: '0.85rem', ...style }}>
      {children}
    </div>
  );
}

/** Horizontal tab strip shown under a modal header. tabs: [{ id, label }] */
export function TabBar({ tabs, active, onChange }) {
  return (
    <div role="tablist" style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem', padding: '0.6rem 1.25rem', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
      {tabs.map(t => (
        <button
          key={t.id}
          role="tab"
          aria-selected={t.id === active}
          className="ui-tab"
          data-active={t.id === active}
          onClick={() => onChange(t.id)}
          style={{ width: 'auto', padding: '0.4rem 0.75rem' }}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

/** Scrollable padded body for a modal / modal tab. */
export function ModalBody({ children, style }) {
  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '1.25rem 1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem', ...style }}>
      {children}
    </div>
  );
}

export function DangerZone({ children }) {
  return (
    <div style={{ borderTop: '1px solid var(--border)', paddingTop: '1rem', display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '0.5rem' }}>
      <FieldLabel style={{ color: 'var(--danger)', marginBottom: 0 }}>Danger Zone</FieldLabel>
      {children}
    </div>
  );
}

export function VoiceCapableToggle({ checked, onChange, disabled }) {
  return (
    <Card style={{ padding: '0.65rem 0.85rem' }}>
      <SettingRow
        style={{ marginBottom: 0 }}
        title="Voice Channel"
        description="Enable voice & video capabilities"
        control={<Toggle checked={checked} onChange={onChange} disabled={disabled} title="Voice Channel" />}
      />
    </Card>
  );
}

/**
 * Square icon preview with Upload / Remove buttons.
 * `src` is the current icon URL or null (then `fallback` is shown instead).
 * `onUpload(file)` / `onRemove()` are async; busy and error state is handled
 * here. The preview itself refreshes via the server's *Updated signal.
 */
export function IconUploadField({ label, src, fallback, alt, onUpload, onRemove, onImageError }) {
  const fileRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function run(action) {
    setBusy(true);
    setError(null);
    try { await action(); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  return (
    <Field label={label}>
      <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-start' }}>
        <div style={{
          width: 64, height: 64, borderRadius: 8, flexShrink: 0, overflow: 'hidden',
          background: 'var(--bg-secondary)', border: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: '2rem', color: 'var(--text-secondary)',
        }}>
          {src
            ? <img src={src} alt={alt} onError={onImageError} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            : fallback}
        </div>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            hidden
            onChange={e => {
              const file = e.target.files?.[0];
              e.target.value = ''; // allow re-selecting the same file
              if (file) run(() => onUpload(file));
            }}
          />
          <Button onClick={() => fileRef.current?.click()} disabled={busy}>
            <UploadIcon size={14} /> {busy ? 'Uploading…' : 'Upload Image'}
          </Button>
          {src && (
            <Button variant="danger" onClick={() => run(onRemove)} disabled={busy}>Remove Icon</Button>
          )}
        </div>
      </div>
      <ErrorBox style={{ marginTop: '0.5rem' }}>{error}</ErrorBox>
    </Field>
  );
}
