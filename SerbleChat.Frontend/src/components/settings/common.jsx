/** Scrollable content area shared by every settings tab. */
export function TabBody({ children, style }) {
  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '1.5rem 1.75rem', ...style }}>
      {children}
    </div>
  );
}

export const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;
