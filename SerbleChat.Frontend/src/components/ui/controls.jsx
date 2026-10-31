import { forwardRef } from 'react';
import { CheckIcon, XCircleIcon } from '../../icons.jsx';

function cx(...names) {
  return names.filter(Boolean).join(' ');
}

/**
 * Range slider with a filled accent track. `onChange` receives a number.
 * Pass `scale` (array of labels) to render evenly spaced labels under the rail.
 */
export function Slider({ value, min = 0, max = 100, step = 1, onChange, scale, className, style, ...rest }) {
  const num = Number(value);
  const pct = max > min ? Math.min(1, Math.max(0, (num - min) / (max - min))) : 0;
  return (
    <div className={className} style={style}>
      <input
        type="range"
        className="ui-slider"
        min={min}
        max={max}
        step={step}
        value={num}
        onChange={e => onChange(Number(e.target.value))}
        style={{ '--pct': pct }}
        {...rest}
      />
      {scale && (
        <div className="ui-slider-scale">
          {scale.map(label => <span key={label}>{label}</span>)}
        </div>
      )}
    </div>
  );
}

/**
 * On/off switch. Without `onChange` it renders as a passive indicator so it can
 * sit inside another clickable element (e.g. an OptionCard).
 */
export function Toggle({ checked, onChange, disabled, title, ...rest }) {
  if (!onChange) {
    return <span className="ui-toggle" data-on={!!checked} aria-hidden="true" {...rest} />;
  }
  return (
    <button
      type="button"
      role="switch"
      aria-checked={!!checked}
      className="ui-toggle"
      data-on={!!checked}
      disabled={disabled}
      title={title}
      onClick={() => onChange(!checked)}
      {...rest}
    />
  );
}

/** variant: primary | secondary | outline | ghost | success | danger | danger-outline */
export function Button({ variant = 'secondary', size, className, type = 'button', ...rest }) {
  return (
    <button
      type={type}
      className={cx('ui-btn', `ui-btn--${variant}`, size === 'sm' && 'ui-btn--sm', className)}
      {...rest}
    />
  );
}

export function IconButton({ className, type = 'button', ...rest }) {
  return <button type={type} className={cx('ui-icon-btn', className)} {...rest} />;
}

export const TextInput = forwardRef(function TextInput({ mono, className, ...rest }, ref) {
  return <input ref={ref} className={cx('ui-input', mono && 'ui-input--mono', className)} {...rest} />;
});

export const TextArea = forwardRef(function TextArea({ mono, className, ...rest }, ref) {
  return <textarea ref={ref} className={cx('ui-input', mono && 'ui-input--mono', className)} {...rest} />;
});

export function Select({ className, ...rest }) {
  return <select className={cx('ui-input', className)} {...rest} />;
}

/** Small inline status for async saves: 'saving' | 'saved' | 'error' | null. */
export function SaveStatus({ status, pendingText = 'Saving…', okText = 'Saved', errorText = 'Failed' }) {
  if (status === 'saving') return <span className="ui-status ui-status--pending">{pendingText}</span>;
  if (status === 'saved') return <span className="ui-status ui-status--ok"><CheckIcon size={11} /> {okText}</span>;
  if (status === 'error') return <span className="ui-status ui-status--error"><XCircleIcon size={11} /> {errorText}</span>;
  return null;
}

export function ErrorBox({ children, style }) {
  if (!children) return null;
  return <div className="ui-error-box" style={style}>{children}</div>;
}

export function Badge({ children }) {
  return <span className="ui-badge">{children}</span>;
}
