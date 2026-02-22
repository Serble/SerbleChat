import { useEffect, useRef } from 'react';
import { useApp } from '../context/AppContext.jsx';

const TYPE_STYLES = {
  info:    { bg: '#1e1f22', border: '#3b3d43',  icon: 'ℹ️' },
  success: { bg: '#1a2e22', border: '#23a55a55', icon: '✅' },
  warning: { bg: '#2a2010', border: '#f0b23255', icon: '⚠️' },
  danger:  { bg: '#2a1515', border: '#f23f4355', icon: '🔴' },
};

function Toast({ toast, onRemove }) {
  const style = TYPE_STYLES[toast.type] ?? TYPE_STYLES.info;
  const timerRef = useRef(null);

  useEffect(() => {
    timerRef.current = setTimeout(() => onRemove(toast.id), toast.duration ?? 5000);
    return () => clearTimeout(timerRef.current);
  }, [toast.id, toast.duration, onRemove]);

  return (
    <div
      style={{
        display: 'flex', alignItems: 'flex-start', gap: '0.6rem',
        padding: '0.75rem 1rem',
        background: style.bg,
        border: `1px solid ${style.border}`,
        borderRadius: '8px',
        boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
        minWidth: 260, maxWidth: 360,
        animation: 'slideIn 0.2s ease',
      }}
    >
      <span style={{ fontSize: '1rem', flexShrink: 0, lineHeight: 1.4 }}>{style.icon}</span>
      <div style={{ flex: 1 }}>
        {toast.title && (
          <div style={{ fontWeight: 700, color: '#f2f3f5', fontSize: '0.875rem', marginBottom: toast.body ? '0.2rem' : 0 }}>
            {toast.title}
          </div>
        )}
        {toast.body && (
          <div style={{ color: '#b5bac1', fontSize: '0.82rem', lineHeight: 1.4 }}>{toast.body}</div>
        )}
      </div>
      <button
        onClick={() => onRemove(toast.id)}
        style={{
          background: 'transparent', border: 'none', color: '#72767d',
          cursor: 'pointer', fontSize: '0.9rem', lineHeight: 1,
          padding: '0.1rem', flexShrink: 0,
          transition: 'color 0.1s',
        }}
        onMouseEnter={e => e.currentTarget.style.color = '#f2f3f5'}
        onMouseLeave={e => e.currentTarget.style.color = '#72767d'}
      >
        ✕
      </button>
    </div>
  );
}

export default function ToastContainer() {
  const { toasts, removeToast } = useApp();

  return (
    <>
      <style>{`
        @keyframes slideIn {
          from { opacity: 0; transform: translateX(24px); }
          to   { opacity: 1; transform: translateX(0); }
        }
      `}</style>
      <div style={{
        position: 'fixed', bottom: '1.25rem', right: '1.25rem',
        zIndex: 900,
        display: 'flex', flexDirection: 'column', gap: '0.5rem',
        alignItems: 'flex-end',
        pointerEvents: 'none',
      }}>
        {toasts.map(t => (
          <div key={t.id} style={{ pointerEvents: 'all' }}>
            <Toast toast={t} onRemove={removeToast} />
          </div>
        ))}
      </div>
    </>
  );
}
