import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { finishFilesConsent } from '../filesAuth.js';
import { LightningIcon, CheckIcon, WarningIcon } from '../icons.jsx';

// Inject loading animation styles
if (typeof document !== 'undefined' && !document.getElementById('files-callback-styles')) {
  const style = document.createElement('style');
  style.id = 'files-callback-styles';
  style.textContent = `
    @keyframes spin {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.5; }
    }
    .callback-spinner {
      animation: spin 2s linear infinite;
    }
    .callback-pulse {
      animation: pulse 2s ease-in-out infinite;
    }
  `;
  document.head.appendChild(style);
}

const s = {
  page: {
    display: 'flex', flexDirection: 'column', alignItems: 'center',
    justifyContent: 'center', minHeight: '100vh', gap: '1.5rem', padding: '2rem',
    background: 'linear-gradient(135deg, #0d0f15 0%, #1a1035 100%)',
  },
  card: {
    background: '#1a1d2e', border: '1px solid #2d3148', borderRadius: '12px',
    padding: '3rem 2.5rem', maxWidth: '480px', width: '100%',
    textAlign: 'center', boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
  },
  loadingContainer: {
    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1.5rem',
  },
  spinner: {
    fontSize: '3rem', display: 'inline-block',
  },
  title: { margin: 0, fontSize: '1.5rem', fontWeight: 700, color: '#f1f5f9' },
  subtitle: { margin: '0.5rem 0 0', fontSize: '0.95rem', color: '#94a3b8', fontWeight: 400 },
  statusGood: {
    padding: '1rem', borderRadius: '8px', marginBottom: '1.5rem',
    background: '#14532d', color: '#86efac',
    fontSize: '0.9rem', fontWeight: 500, display: 'flex', alignItems: 'center', gap: '0.75rem',
  },
  statusError: {
    padding: '1rem', borderRadius: '8px', marginBottom: '1.5rem',
    background: '#7f1d1d', color: '#fca5a5',
    fontSize: '0.9rem', fontWeight: 500,
  },
  errorTitle: {
    fontSize: '1.1rem', fontWeight: 600, color: '#fca5a5', marginBottom: '0.5rem',
  },
  errorMessage: {
    fontSize: '0.85rem', color: '#fecaca', margin: '0.5rem 0', lineHeight: 1.5,
  },
  btn: {
    padding: '0.7rem 1.8rem', borderRadius: '6px', fontWeight: 600,
    fontSize: '0.9rem', cursor: 'pointer', border: 'none',
    transition: 'all 0.2s ease',
  },
  btnPrimary: {
    background: 'linear-gradient(135deg, #7c3aed 0%, #5b21b6 100%)',
    color: '#fff',
    marginRight: '0.75rem',
  },
  btnSecondary: {
    background: '#2d3148', color: '#94a3b8',
  },
  buttonGroup: {
    display: 'flex', gap: '0.75rem', justifyContent: 'center', marginTop: '1.5rem',
    flexWrap: 'wrap',
  },
};

// Serble sends the user back here after they allow (or refuse) SerbleChat signing them in to
// Serble Files. finishFilesConsent checks the state and connects Files.
export default function FilesCallbackPage() {
  const navigate = useNavigate();
  const [stage, setStage] = useState('exchanging'); // 'exchanging', 'success', 'error'
  const [errorTitle, setErrorTitle] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [returnTo, setReturnTo] = useState('/app');

  useEffect(() => {
    (async () => {
      const result = await finishFilesConsent(new URLSearchParams(window.location.search));
      setReturnTo(result.returnTo);
      if (!result.ok) {
        setErrorTitle("Couldn't connect Serble Files");
        setErrorMessage(result.error);
        setStage('error');
        return;
      }
      setStage('success');
      setTimeout(() => navigate(result.returnTo, { replace: true }), 1000);
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div style={s.page}>
      <div style={s.card}>
        {/* Loading State */}
        {stage === 'exchanging' ? (
          <div style={s.loadingContainer}>
            <div style={{ ...s.spinner, ...{} }} className="callback-spinner">
              <LightningIcon size={48} />
            </div>
            <h2 style={s.title}>Connecting Serble Files...</h2>
            <p style={s.subtitle}>Completing authentication</p>
          </div>
        ) : null}

        {/* Success State */}
        {stage === 'success' && (
          <div style={s.loadingContainer}>
            <CheckIcon size={48} />
            <h2 style={s.title}>Serble Files Connected!</h2>
            <p style={s.subtitle}>Redirecting you to the app...</p>
          </div>
        )}

        {/* Error State */}
        {stage === 'error' && (
          <>
            <div style={s.statusError}>
              <div style={s.errorTitle}><WarningIcon size={20} /> {errorTitle}</div>
              <div style={s.errorMessage}>{errorMessage}</div>
            </div>
            <div style={s.buttonGroup}>
              <button
                style={{ ...s.btn, ...s.btnPrimary }}
                onClick={() => navigate(returnTo, { replace: true })}
              >
                Back to App
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
