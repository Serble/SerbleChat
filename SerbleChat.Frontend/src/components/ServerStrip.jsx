import { useNavigate, useLocation } from 'react-router-dom';

function StripButton({ title, active, onClick, children }) {
  const base = {
    width: 48, height: 48, borderRadius: active ? '30%' : '50%',
    background: active ? '#7c3aed' : '#36393f',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    cursor: 'pointer', color: '#fff', fontWeight: 700, fontSize: '1.25rem',
    transition: 'border-radius 0.2s, background 0.2s',
    userSelect: 'none', border: 'none', flexShrink: 0,
  };
  return (
    <button
      title={title}
      onClick={onClick}
      style={base}
      onMouseEnter={e => {
        if (!active) {
          e.currentTarget.style.borderRadius = '30%';
          e.currentTarget.style.background = '#7c3aed';
        }
      }}
      onMouseLeave={e => {
        if (!active) {
          e.currentTarget.style.borderRadius = '50%';
          e.currentTarget.style.background = '#36393f';
        }
      }}
    >
      {children}
    </button>
  );
}

export default function ServerStrip() {
  const nav = useNavigate();
  const loc = useLocation();
  const onHome = loc.pathname.startsWith('/app');

  return (
    <div style={{
      width: 72, background: '#1e1f22', flexShrink: 0,
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      paddingTop: '0.75rem', gap: '0.5rem',
      borderRight: '1px solid #111213',
    }}>
      <StripButton title="Home" active={onHome} onClick={() => nav('/app/friends')}>
        🏠
      </StripButton>
      {/* Divider */}
      <div style={{ width: 32, height: 2, background: '#36393f', borderRadius: 1 }} />
      {/* Future: guilds would appear here */}
    </div>
  );
}
