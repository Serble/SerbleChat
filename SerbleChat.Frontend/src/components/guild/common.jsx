import { TextInput } from '../ui/index.js';
import { CheckIcon, CrossIcon, PlusIcon } from '../../icons.jsx';

// Small building blocks shared by the guild / channel modals.

export const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

/** Muted single-line text for loading / empty states. */
export function MutedText({ children, subtle, style }) {
  return (
    <div style={{ color: subtle ? 'var(--text-subtle)' : 'var(--text-muted)', fontSize: '0.85rem', ...style }}>
      {children}
    </div>
  );
}

/** Red-bordered box of destructive actions, each a <DangerRow>. */
export function DangerZone({ children }) {
  return <div className="danger-zone">{children}</div>;
}

export function DangerRow({ title, description, action }) {
  return (
    <div className="danger-row">
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-primary)' }}>{title}</div>
        {description && <div className="ui-hint" style={{ marginTop: '0.15rem' }}>{description}</div>}
      </div>
      {action}
    </div>
  );
}

export function RoleDot({ color, size = 10, style }) {
  return (
    <span style={{
      display: 'inline-block', width: size, height: size, borderRadius: '50%', flexShrink: 0,
      background: color || 'var(--text-muted)', boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.12)',
      ...style,
    }} />
  );
}

const SWATCHES = ['#e74c3c', '#e67e22', '#f1c40f', '#2ecc71', '#1abc9c', '#3498db', '#9b59b6', '#e91e63'];

/**
 * Colour chooser: "no colour", a row of preset swatches, a custom colour
 * picker and a hex box. `value` is '' (no colour) or '#rrggbb'; `onChange`
 * receives the raw hex-box text too, so validate with HEX_COLOR_RE.
 */
export function ColourPicker({ value, onChange, disabled }) {
  const valid = value === '' || HEX_COLOR_RE.test(value);
  const isCustom = HEX_COLOR_RE.test(value) && !SWATCHES.includes(value.toLowerCase());

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
      <div className="swatches" role="radiogroup" aria-label="Colour">
        <button
          type="button" role="radio" aria-checked={value === ''} title="No colour"
          className="swatch swatch--none" data-active={value === ''} disabled={disabled}
          onClick={() => onChange('')}
        >
          {value === '' ? <CheckIcon size={12} strokeWidth={3} /> : <CrossIcon size={12} />}
        </button>
        {SWATCHES.map(c => {
          const active = value.toLowerCase() === c;
          return (
            <button
              key={c} type="button" role="radio" aria-checked={active} title={c}
              className="swatch" data-active={active} disabled={disabled}
              style={{ background: c }}
              onClick={() => onChange(c)}
            >
              {active && <CheckIcon size={12} strokeWidth={3} />}
            </button>
          );
        })}
        <label
          className="swatch swatch--custom" data-active={isCustom} title="Custom colour"
          style={isCustom ? { background: value } : undefined}
          data-disabled={!!disabled}
        >
          {isCustom ? <CheckIcon size={12} strokeWidth={3} /> : <PlusIcon size={12} />}
          <input
            type="color" disabled={disabled}
            value={HEX_COLOR_RE.test(value) ? value : '#99aab5'}
            onChange={e => onChange(e.target.value)}
          />
        </label>
      </div>
      <TextInput
        mono
        value={value}
        onChange={e => onChange(e.target.value.trim())}
        maxLength={7}
        placeholder="#rrggbb"
        disabled={disabled}
        aria-invalid={!valid}
        style={{ width: 92, padding: '0.25rem 0.5rem', fontSize: '0.83rem', borderColor: valid ? undefined : 'var(--danger)' }}
      />
    </div>
  );
}
