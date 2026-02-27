import { useState, useEffect } from 'react';
import { initPWAInstallPrompt, promptInstall, canInstall, isInstalled } from '../pwa.js';

/**
 * PWAInstallButton - A button that prompts the user to install the PWA
 * 
 * Usage:
 *   <PWAInstallButton />
 * 
 * Or with custom styling:
 *   <PWAInstallButton className="my-button" />
 */
export default function PWAInstallButton({ className = '', children }) {
  const [installable, setInstallable] = useState(false);
  const [installing, setInstalling] = useState(false);

  useEffect(() => {
    // Don't show if already installed
    if (isInstalled()) {
      return;
    }

    // Initialize install prompt handling
    initPWAInstallPrompt((canInstall) => {
      setInstallable(canInstall);
    });

    // Check initial state
    setInstallable(canInstall());
  }, []);

  const handleInstall = async () => {
    setInstalling(true);
    const result = await promptInstall();
    
    if (result.outcome === 'accepted') {
      console.log('User accepted the install prompt');
    } else if (result.outcome === 'dismissed') {
      console.log('User dismissed the install prompt');
    }
    
    setInstalling(false);
    setInstallable(false);
  };

  // Don't render if not installable
  if (!installable) {
    return null;
  }

  return (
    <button
      onClick={handleInstall}
      disabled={installing}
      className={className}
      style={{
        padding: '10px 20px',
        backgroundColor: '#5865F2',
        color: 'white',
        border: 'none',
        borderRadius: '6px',
        cursor: installing ? 'wait' : 'pointer',
        fontSize: '14px',
        fontWeight: '500',
        opacity: installing ? 0.7 : 1,
        ...(!className && { display: 'flex', alignItems: 'center', gap: '8px' })
      }}
    >
      {installing ? (
        <>Installing...</>
      ) : (
        children || (
          <>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/>
            </svg>
            Install App
          </>
        )
      )}
    </button>
  );
}
