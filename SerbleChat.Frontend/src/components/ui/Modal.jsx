import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useMobile } from '../../context/MobileContext.jsx';
import { CloseIcon } from '../../icons.jsx';
import { IconButton } from './controls.jsx';

// Open modals, oldest first. Only the topmost one reacts to Escape, so a
// confirm dialog opened over a settings modal doesn't close both at once.
const modalStack = [];

/**
 * Shared modal shell: portal, dimmed backdrop, Escape-to-close and
 * click-outside-to-close (only when the press also *started* on the backdrop,
 * so drag-selecting text inside the modal doesn't dismiss it).
 * Goes full-screen on mobile.
 *
 * `title` renders the standard header with a close button (`subtitle` sits
 * next to it in muted text); omit it to render a custom header inside
 * `children`. Pass `onSubmit` to wrap the content in a <form>, so Enter in a
 * field submits and a `type="submit"` button in the footer works.
 *
 * Simple modals are laid out as <ModalBody> + <ModalFooter>.
 */
export default function Modal({ onClose, title, subtitle, icon: Icon, width = 480, height, style, onSubmit, children }) {
  const { isMobile } = useMobile();
  const pressStartedOnBackdrop = useRef(false);
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; });

  useEffect(() => {
    const token = {};
    modalStack.push(token);
    function onKey(e) {
      // A popup menu inside the modal handles (and claims) its own Escape
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      if (modalStack[modalStack.length - 1] !== token) return;
      onCloseRef.current();
    }
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      modalStack.splice(modalStack.indexOf(token), 1);
    };
  }, []);

  const content = onSubmit
    ? <form className="ui-modal-form" onSubmit={e => { e.preventDefault(); onSubmit(e); }}>{children}</form>
    : children;

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
            <span className="ui-modal-title">
              {Icon && <Icon size={16} />}
              {title}
              {subtitle && <span className="ui-modal-subtitle">{subtitle}</span>}
            </span>
            <IconButton onClick={onClose} title="Close" aria-label="Close"><CloseIcon size={14} /></IconButton>
          </div>
        )}
        {content}
      </div>
    </div>,
    document.body
  );
}

/** Padded, scrollable content area of a simple modal. */
export function ModalBody({ children, style }) {
  return <div className="ui-modal-body" style={style}>{children}</div>;
}

/** Action bar along the bottom of a modal; buttons are right-aligned. `left` sits on the far left. */
export function ModalFooter({ children, left }) {
  return (
    <div className="ui-modal-footer">
      {left && <div style={{ marginRight: 'auto', minWidth: 0 }}>{left}</div>}
      {children}
    </div>
  );
}
