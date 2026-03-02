import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';

/**
 * Modal image viewer that displays an image fullscreen with a dark overlay.
 * Clicking outside the image closes the modal.
 * Props: isOpen (bool), imageUrl (string), onClose (func), filename (string), onContextMenu (func)
 */
export default function ImageModal({ isOpen, imageUrl, onClose, filename, onContextMenu }) {
  const [isLoading, setIsLoading] = useState(true);
  const [imageError, setImageError] = useState(false);

  // Reset loading state when imageUrl changes
  useEffect(() => {
    setIsLoading(true);
    setImageError(false);
  }, [imageUrl]);

  // Handle Escape key to close modal
  useEffect(() => {
    if (!isOpen) return;

    function handleEscape(e) {
      if (e.key === 'Escape') {
        onClose();
      }
    }

    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [isOpen, onClose]);

  if (!isOpen || !imageUrl) return null;

  const handleBackdropClick = (e) => {
    // Only close if clicking directly on the backdrop, not on the image
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  const content = (
    <div
      onClick={handleBackdropClick}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0, 0, 0, 0.9)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9999,
        cursor: 'pointer',
        animation: 'fadeIn 0.2s ease-out',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          position: 'relative',
          maxWidth: '90vw',
          maxHeight: '90vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {/* Loading spinner */}
        {isLoading && (
          <div
            style={{
              position: 'absolute',
              width: 40,
              height: 40,
              border: '3px solid rgba(255, 255, 255, 0.2)',
              borderTop: '3px solid #fff',
              borderRadius: '50%',
              animation: 'spin 1s linear infinite',
            }}
          />
        )}

        {/* Error message */}
        {imageError && (
          <div
            style={{
              color: '#fff',
              fontSize: '1.1rem',
              textAlign: 'center',
            }}
          >
            <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>❌</div>
            Failed to load image
          </div>
        )}

        {/* Image */}
        {!imageError && (
          <img
            src={imageUrl}
            alt="Expanded view"
            onLoad={() => setIsLoading(false)}
            onError={() => {
              setImageError(true);
              setIsLoading(false);
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (onContextMenu) {
                onContextMenu(e);
              }
            }}
            style={{
              maxWidth: '100%',
              maxHeight: '100%',
              objectFit: 'contain',
              borderRadius: '8px',
              boxShadow: '0 20px 60px rgba(0, 0, 0, 0.8)',
              opacity: isLoading ? 0 : 1,
              transition: 'opacity 0.2s ease-out',
            }}
          />
        )}

        {/* Close button */}
        <button
          onClick={onClose}
          title="Close (ESC)"
          style={{
            position: 'absolute',
            top: '-50px',
            right: 0,
            background: 'rgba(255, 255, 255, 0.2)',
            border: 'none',
            color: '#fff',
            fontSize: '1.8rem',
            width: 44,
            height: 44,
            borderRadius: '50%',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'background 0.15s',
            lineHeight: 1,
          }}
          onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255, 255, 255, 0.3)')}
          onMouseLeave={e => (e.currentTarget.style.background = 'rgba(255, 255, 255, 0.2)')}
        >
          ✕
        </button>

        {/* Filename display */}
        {filename && (
          <div
            style={{
              position: 'absolute',
              bottom: '-40px',
              left: 0,
              right: 0,
              textAlign: 'center',
              color: 'rgba(255, 255, 255, 0.7)',
              fontSize: '0.85rem',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              padding: '0 1rem',
            }}
          >
            {filename}
          </div>
        )}
      </div>

      {/* CSS animations */}
      <style>{`
        @keyframes fadeIn {
          from {
            opacity: 0;
          }
          to {
            opacity: 1;
          }
        }
        @keyframes spin {
          from {
            transform: rotate(0deg);
          }
          to {
            transform: rotate(360deg);
          }
        }
      `}</style>
    </div>
  );

  return createPortal(content, document.body);
}
