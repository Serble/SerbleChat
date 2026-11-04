import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { XCircleIcon, CloseIcon, PlusIcon, MinusIcon } from '../../icons.jsx';
import { useStreamZoom } from '../voice/useStreamZoom.js';
import './chat.css';
import '../voice/voice.css';

/**
 * Modal image viewer that displays an image fullscreen with a dark overlay.
 * Scroll, pinch or double-click to zoom in, drag to pan. Clicking outside the image closes it.
 * Props: isOpen (bool), imageUrl (string), onClose (func), filename (string), onContextMenu (func)
 */
export default function ImageModal({ isOpen, imageUrl, onClose, filename, onContextMenu }) {
  const [isLoading, setIsLoading] = useState(true);
  const [imageError, setImageError] = useState(false);
  const stageRef = useRef(null);
  const [imgEl, setImgEl] = useState(null);
  const zoom = useStreamZoom(stageRef, imgEl, isOpen && !!imageUrl && !isLoading && !imageError);
  const { reset } = zoom;

  // Reset loading state (and zoom) when imageUrl changes
  useEffect(() => {
    setIsLoading(true);
    setImageError(false);
    reset();
  }, [imageUrl, reset]);

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

  const ready = !isLoading && !imageError;

  // The image fills the whole screen so it can be zoomed edge to edge; its padding keeps
  // the unzoomed picture clear of the close button and filename
  function handleStageClick(e) {
    const { clientX, clientY } = e;
    // Clicks around the picture close the viewer (straight away: there's nothing to double-click there)
    zoom.handleClick(() => {
      if (!ready || !zoom.isOnContent(clientX, clientY)) onClose();
    }, { delay: false });
  }

  function handleMouseMove(e) {
    const stage = stageRef.current;
    if (!stage || !ready) return;
    stage.style.cursor = zoom.zoomed ? 'grab' : (zoom.isOnContent(e.clientX, e.clientY) ? 'zoom-in' : 'pointer');
  }

  return createPortal(
    <div
      className="image-viewer"
      // React events bubble through portals: keep right-clicks in the viewer from
      // reaching the message row underneath (which would open its context menu).
      onContextMenu={e => e.stopPropagation()}
      onClick={e => e.stopPropagation()}
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        background: 'rgba(0, 0, 0, 0.9)',
        overflow: 'hidden',
        animation: 'chatFadeIn 0.2s ease-out',
      }}
    >
      <div
        ref={stageRef}
        className="image-viewer-stage"
        onClick={handleStageClick}
        onMouseMove={handleMouseMove}
        onContextMenu={e => {
          e.preventDefault();
          if (ready && zoom.isOnContent(e.clientX, e.clientY)) onContextMenu?.(e);
        }}
        style={{
          position: 'absolute', inset: 0,
          cursor: 'pointer',
          // Pinch zooms the image rather than the page
          touchAction: 'none',
        }}
      >
        {!imageError && (
          <img
            ref={setImgEl}
            src={imageUrl}
            alt="Expanded view"
            draggable={false}
            onLoad={() => setIsLoading(false)}
            onError={() => {
              setImageError(true);
              setIsLoading(false);
            }}
            style={{
              display: 'block',
              width: '100%', height: '100%',
              padding: 'max(56px, 5vh) 5vw',
              objectFit: 'scale-down',
              userSelect: 'none',
              opacity: isLoading ? 0 : 1,
              transition: 'opacity 0.2s ease-out',
            }}
          />
        )}
      </div>

      {/* Loading spinner */}
      {isLoading && (
        <div style={{
          position: 'absolute', top: '50%', left: '50%', margin: '-20px 0 0 -20px',
          width: 40, height: 40,
          border: '3px solid rgba(255, 255, 255, 0.2)', borderTop: '3px solid #fff',
          borderRadius: '50%', animation: 'spin 1s linear infinite',
          pointerEvents: 'none',
        }} />
      )}

      {imageError && (
        <div style={{
          position: 'absolute', top: '50%', left: 0, right: 0, transform: 'translateY(-50%)',
          color: '#fff', fontSize: '1.1rem', textAlign: 'center', pointerEvents: 'none',
        }}>
          <XCircleIcon size={32} />
          Failed to load image
        </div>
      )}

      <button
        className="chat-overlay-btn chat-overlay-btn--light"
        onClick={onClose}
        title="Close (ESC)"
        style={{ position: 'absolute', top: 12, right: 12, width: 40, height: 40, borderRadius: '50%', zIndex: 1 }}
      >
        <CloseIcon size={14} />
      </button>

      {filename && (
        <div style={{
          position: 'absolute', bottom: 12, left: '50%', transform: 'translateX(-50%)',
          maxWidth: 'calc(100vw - 2rem - 180px)',
          padding: '0.2rem 0.6rem', borderRadius: 6,
          background: zoom.zoomed ? 'rgba(0, 0, 0, 0.6)' : 'transparent',
          color: 'rgba(255, 255, 255, 0.7)', fontSize: '0.85rem',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          pointerEvents: 'none',
        }}>
          {filename}
        </div>
      )}

      {ready && (
        <div className="stream-zoom-bar image-zoom-bar" data-zoomed={zoom.zoomed}>
          <button type="button" onClick={zoom.zoomOut} disabled={!zoom.zoomed} title="Zoom out" aria-label="Zoom out">
            <MinusIcon size={14} />
          </button>
          <button type="button" className="stream-zoom-level" onClick={zoom.reset} disabled={!zoom.zoomed} title="Reset zoom">
            {Math.round(zoom.scale * 100)}%
          </button>
          <button type="button" onClick={zoom.zoomIn} disabled={zoom.scale >= 7.99} title="Zoom in (or scroll, pinch, double-click)" aria-label="Zoom in">
            <PlusIcon size={14} />
          </button>
        </div>
      )}
    </div>,
    document.body
  );
}
