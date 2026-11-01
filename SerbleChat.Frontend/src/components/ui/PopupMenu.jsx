import { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { CheckIcon } from '../../icons.jsx';

const MARGIN = 8;

/**
 * Floating popup at viewport coords (x, y), portalled to <body>. Closes on
 * Escape or a mousedown outside it, and keeps itself inside the viewport —
 * re-clamping if its content changes size (e.g. after "Loading…" resolves).
 */
export default function PopupMenu({ x, y, onClose, width, zIndex = 9000, className, style, children }) {
  const ref = useRef(null);
  // Latest onClose via ref so callers can pass inline lambdas without the
  // listeners being re-added every render.
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; });

  useEffect(() => {
    function onDown(e) {
      if (ref.current && !ref.current.contains(e.target)) onCloseRef.current();
    }
    function onKey(e) {
      if (e.key !== 'Escape') return;
      e.preventDefault(); // claim it, so a modal underneath stays open
      onCloseRef.current();
    }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, []);

  // Position is written directly (not via the style prop) so it can follow
  // the measured size without an extra render.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    function place() {
      const { width: w, height: h } = el.getBoundingClientRect();
      el.style.left = `${Math.max(MARGIN, Math.min(x, window.innerWidth  - w - MARGIN))}px`;
      el.style.top  = `${Math.max(MARGIN, Math.min(y, window.innerHeight - h - MARGIN))}px`;
    }
    place();
    const ro = new ResizeObserver(place);
    ro.observe(el);
    return () => ro.disconnect();
  }, [x, y]);

  return createPortal(
    <div
      ref={ref}
      role="menu"
      className={className ? `ui-popup ${className}` : 'ui-popup'}
      style={{ left: x, top: y, zIndex, width, ...style }}
    >
      {children}
    </div>,
    document.body
  );
}

/** Right-click style menu: a PopupMenu laid out for MenuItems. */
export function ContextMenu({ minWidth, ...rest }) {
  return <PopupMenu className="ui-menu" style={minWidth ? { minWidth } : undefined} {...rest} />;
}

/** variant: 'default' | 'danger'. `copied` swaps the label for a "Copied!" confirmation. */
export function MenuItem({ icon: Icon, label, onClick, variant = 'default', copied = false, disabled = false }) {
  return (
    <button
      type="button"
      role="menuitem"
      className="ui-menu-item"
      data-variant={variant}
      data-copied={copied}
      disabled={disabled}
      onClick={onClick}
    >
      {(copied || Icon) && (
        <span className="ui-menu-icon">{copied ? <CheckIcon size={14} /> : <Icon size={14} />}</span>
      )}
      {copied ? 'Copied!' : label}
    </button>
  );
}

export function MenuDivider() {
  return <div className="ui-menu-divider" />;
}

/**
 * "Copied!" feedback for menu items: `flash(key)` marks that item as copied
 * and closes the menu a moment later. The timer is cleared on unmount.
 */
export function useCopyFlash(onClose, ms = 1000) {
  const [copied, setCopied] = useState(null);
  const timerRef = useRef(null);
  useEffect(() => () => clearTimeout(timerRef.current), []);
  const flash = useCallback(key => {
    clearTimeout(timerRef.current);
    setCopied(key);
    timerRef.current = setTimeout(onClose, ms);
  }, [onClose, ms]);
  return [copied, flash];
}
