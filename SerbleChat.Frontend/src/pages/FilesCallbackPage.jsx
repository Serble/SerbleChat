import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { filesAuthenticateWithCode } from '../filesApi.js';
import { useClientOptions } from '../context/ClientOptionsContext.jsx';

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

export default function FilesCallbackPage() {
  const navigate = useNavigate();
  const { setFilesApiToken } = useClientOptions();
  const [stage, setStage] = useState('init'); // 'init', 'exchanging', 'success', 'error'
  const [errorTitle, setErrorTitle] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    (async () => {
      const params = new URLSearchParams(window.location.search);
      const authorized = params.get('authorized');
      const code = params.get('code');
      const returnedState = params.get('state');
      const savedState = sessionStorage.getItem('files_oauth_state');

      // ── CSRF state check ────────────────────────────────────────────────────
      if (returnedState !== savedState) {
        setErrorTitle('Security Check Failed');
        setErrorMessage('State mismatch detected. This could indicate a security issue. Please try logging in again.');
        setStage('error');
        sessionStorage.removeItem('files_oauth_state');
        return;
      }
      sessionStorage.removeItem('files_oauth_state');

      // ── Authorization check ──────────────────────────────────────────────────
      if (authorized !== 'true' || !code) {
        setErrorTitle('Login Cancelled or Invalid');
        setErrorMessage('You denied the login request or the authorization code is missing. Please try again.');
        setStage('error');
        return;
      }

      // ── Exchange code for token ──────────────────────────────────────────────
      setStage('exchanging');

      try {
        const data = await filesAuthenticateWithCode(code);
        if (!data.accessToken) {
          throw new Error('Files API did not return an access token');
        }

        // Save token directly to ClientOptions
        setFilesApiToken(data.accessToken);

        // Also dispatch event for any listeners
        window.dispatchEvent(new CustomEvent('filesOAuthSuccess', {
          detail: { token: data.accessToken }
        }));

        setStage('success');
        setTimeout(() => {
          // Redirect back to app
          navigate('/app', { replace: true });
        }, 1000);
      } catch (err) {
        setErrorTitle('Login Failed');
        setErrorMessage(err.message || 'Could not complete the login process. Please check your connection and try again.');
        setStage('error');
      }
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div style={s.page}>
      <div style={s.card}>
        {/* Loading State */}
        {stage === 'init' || stage === 'exchanging' ? (
          <div style={s.loadingContainer}>
            <div style={{ ...s.spinner, ...{} }} className="callback-spinner">
              ⚡
            </div>
            <h2 style={s.title}>Authenticating Files API...</h2>
            <p style={s.subtitle}>
              {stage === 'init' ? 'Verifying your credentials' : 'Completing authentication'}
            </p>
          </div>
        ) : null}

        {/* Success State */}
        {stage === 'success' && (
          <div style={s.loadingContainer}>
            <div style={{ fontSize: '3rem' }}>✓</div>
            <h2 style={s.title}>Files API Connected!</h2>
            <p style={s.subtitle}>Redirecting you to the app...</p>
          </div>
        )}

        {/* Error State */}
        {stage === 'error' && (
          <>
            <div style={s.statusError}>
              <div style={s.errorTitle}>⚠️ {errorTitle}</div>
              <div style={s.errorMessage}>{errorMessage}</div>
            </div>
            <div style={s.buttonGroup}>
              <button
                style={{ ...s.btn, ...s.btnPrimary }}
                onClick={() => navigate('/app')}
              >
                Back to App
              </button>
              <button
                style={{ ...s.btn, ...s.btnSecondary }}
                onClick={() => window.location.reload()}
              >
                Retry
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
