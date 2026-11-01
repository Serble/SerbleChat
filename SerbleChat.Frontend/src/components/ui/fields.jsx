/** Small uppercase label above a form field. */
export function FieldLabel({ children, htmlFor, style }) {
  return (
    <label
      htmlFor={htmlFor}
      style={{
        display: 'block', fontSize: '0.72rem', fontWeight: 700,
        color: 'var(--text-muted)', textTransform: 'uppercase',
        letterSpacing: '0.07em', marginBottom: '0.4rem',
        ...style,
      }}
    >
      {children}
    </label>
  );
}

/** A FieldLabel with its control underneath, plus an optional hint or error line. */
export function Field({ label, htmlFor, hint, error, children, style }) {
  return (
    <div style={style}>
      <FieldLabel htmlFor={htmlFor}>{label}</FieldLabel>
      {children}
      {(error || hint) && (
        <div className="ui-hint" style={{ marginTop: '0.35rem', color: error ? 'var(--danger)' : undefined }}>
          {error || hint}
        </div>
      )}
    </div>
  );
}

/** Text input with a fixed prefix glyph inside it (e.g. "#" for channel names). */
export function PrefixInput({ prefix, children }) {
  return (
    <div className="ui-prefix-input">
      <span className="ui-prefix-input-glyph" aria-hidden="true">{prefix}</span>
      {children}
    </div>
  );
}
