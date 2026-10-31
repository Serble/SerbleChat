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

/** A FieldLabel with its control underneath. */
export function Field({ label, children, style }) {
  return (
    <div style={style}>
      <FieldLabel>{label}</FieldLabel>
      {children}
    </div>
  );
}
