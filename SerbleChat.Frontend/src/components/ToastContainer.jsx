import { useEffect, useRef } from 'react';
import { useApp } from '../context/AppContext.jsx';

const TYPE_STYLES = {
  info:    { bg: 'var(--bg-secondary)', border: 'var(--accent)', icon: 'ℹ️' },
  success: { bg: 'rgba(35, 165, 90, 0.15)', border: 'rgba(35, 165, 90, 0.4)', icon: '✅' },
  warning: { bg: 'rgba(240, 178, 50, 0.15)', border: 'rgba(240, 178, 50, 0.4)', icon: '⚠️' },
  danger:  { bg: 'rgba(242, 63, 67, 0.15)', border: 'rgba(242, 63, 67, 0.4)', icon: '🔴' },
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
          <div style={{ fontWeight: 700, color: 'var(--text-primary)', fontSize: '0.875rem', marginBottom: toast.body ? '0.2rem' : 0 }}>
            {toast.title}
          </div>
        )}
        {toast.body && (
          <div style={{ color: 'var(--text-secondary)', fontSize: '0.82rem', lineHeight: 1.4 }}>{toast.body}</div>
        )}
      </div>
      <button
        onClick={() => onRemove(toast.id)}
        style={{
          background: 'transparent', border: 'none', color: 'var(--text-muted)',
          cursor: 'pointer', fontSize: '0.9rem', lineHeight: 1,
          padding: '0.1rem', flexShrink: 0,
          transition: 'color 0.1s',
        }}
        className="hov-text-primary"
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
