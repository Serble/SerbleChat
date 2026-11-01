import { useMobile } from '../../context/MobileContext.jsx';
import { ChevronLeftIcon } from '../../icons.jsx';

/**
 * List / detail layout for a TabbedModal tab (roles, permission overrides).
 * Desktop: a fixed-width list column beside the detail pane.
 * Mobile: one pane at a time — the detail pane gets a back button that calls
 * `onBack` (which should clear the selection).
 */
export default function SplitPane({ title, count, action, list, footer, detail, showDetail, onBack, backLabel = 'Back' }) {
  const { isMobile } = useMobile();
  const showList = !isMobile || !showDetail;
  const showDetailPane = !isMobile || showDetail;

  return (
    <div className="ui-split" data-mobile={isMobile}>
      {showList && (
        <div className="ui-split-list">
          <div className="ui-split-head">
            <span className="ui-split-title">
              {title}
              {count != null && <span className="ui-split-count">{count}</span>}
            </span>
            {action}
          </div>
          <div className="ui-split-items" role="listbox">{list}</div>
          {footer && <div className="ui-split-foot">{footer}</div>}
        </div>
      )}
      {showDetailPane && (
        <div className="ui-split-detail">
          {isMobile && (
            <button type="button" className="ui-split-back" onClick={onBack}>
              <ChevronLeftIcon size={16} /> {backLabel}
            </button>
          )}
          {detail}
        </div>
      )}
    </div>
  );
}

/** Selectable row in a SplitPane list. */
export function SplitItem({ active, onClick, children, title }) {
  return (
    <button type="button" role="option" aria-selected={!!active} className="ui-split-item" data-active={!!active} onClick={onClick} title={title}>
      {children}
    </button>
  );
}
