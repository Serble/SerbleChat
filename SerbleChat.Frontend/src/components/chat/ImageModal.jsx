import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { XCircleIcon, CloseIcon } from '../../icons.jsx';
import './chat.css';

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
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [isOpen, onClose]);

  if (!isOpen || !imageUrl) return null;

  return createPortal(
    <div
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
      // React events bubble through portals: keep right-clicks in the viewer from
      // reaching the message row underneath (which would open its context menu).
      onContextMenu={e => e.stopPropagation()}
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        background: 'rgba(0, 0, 0, 0.9)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        cursor: 'pointer',
        animation: 'chatFadeIn 0.2s ease-out',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          position: 'relative',
          maxWidth: '90vw', maxHeight: '90vh',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      >
        {/* Loading spinner */}
        {isLoading && (
          <div style={{
            position: 'absolute', width: 40, height: 40,
            border: '3px solid rgba(255, 255, 255, 0.2)', borderTop: '3px solid #fff',
            borderRadius: '50%', animation: 'spin 1s linear infinite',
          }} />
        )}

        {imageError ? (
          <div style={{ color: '#fff', fontSize: '1.1rem', textAlign: 'center' }}>
            <XCircleIcon size={32} />
            Failed to load image
          </div>
        ) : (
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
              onContextMenu?.(e);
            }}
            style={{
              maxWidth: '100%', maxHeight: '100%', objectFit: 'contain',
              borderRadius: '8px', boxShadow: '0 20px 60px rgba(0, 0, 0, 0.8)',
              opacity: isLoading ? 0 : 1,
              transition: 'opacity 0.2s ease-out',
            }}
          />
        )}

        <button
          className="chat-overlay-btn chat-overlay-btn--light"
          onClick={onClose}
          title="Close (ESC)"
          style={{ position: 'absolute', top: '-50px', right: 0, width: 44, height: 44, borderRadius: '50%' }}
        >
          <CloseIcon size={14} />
        </button>

        {filename && (
          <div style={{
            position: 'absolute', bottom: '-40px', left: 0, right: 0,
            textAlign: 'center', color: 'rgba(255, 255, 255, 0.7)', fontSize: '0.85rem',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            padding: '0 1rem',
          }}>
            {filename}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
