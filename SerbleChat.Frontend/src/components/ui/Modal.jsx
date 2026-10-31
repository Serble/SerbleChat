import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useMobile } from '../../context/MobileContext.jsx';
import { CloseIcon } from '../../icons.jsx';
import { IconButton } from './controls.jsx';

/**
 * Shared modal shell: portal, dimmed backdrop, Escape-to-close and
 * click-outside-to-close (only when the press also *started* on the backdrop,
 * so drag-selecting text inside the modal doesn't dismiss it).
 * Goes full-screen on mobile.
 *
 * `title` renders the standard header with a close button; omit it to render
 * a custom header inside `children`.
 */
export default function Modal({ onClose, title, icon: Icon, width = 480, height, style, children }) {
  const { isMobile } = useMobile();
  const pressStartedOnBackdrop = useRef(false);

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return createPortal(
    <div
      className="ui-modal-backdrop"
      data-mobile={isMobile}
      onMouseDown={e => { pressStartedOnBackdrop.current = e.target === e.currentTarget; }}
      onClick={e => {
        if (pressStartedOnBackdrop.current && e.target === e.currentTarget) onClose();
        pressStartedOnBackdrop.current = false;
      }}
    >
      <div className="ui-modal" role="dialog" aria-modal="true" style={{ maxWidth: width, height, ...style }}>
        {title && (
          <div className="ui-modal-header">
            <span className="ui-modal-title">{Icon && <Icon size={16} />}{title}</span>
            <IconButton onClick={onClose} title="Close" aria-label="Close"><CloseIcon size={14} /></IconButton>
          </div>
        )}
        {children}
      </div>
    </div>,
    document.body
  );
}
