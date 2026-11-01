import { useMobile } from '../../context/MobileContext.jsx';
import Modal from './Modal.jsx';

/**
 * Settings-style modal: a vertical tab sidebar on the left and the active
 * tab's content on the right (a horizontal strip on mobile).
 *
 * The modal has a fixed size so it doesn't jump around as tabs with different
 * amounts of content are selected — each tab scrolls internally (wrap simple
 * tabs in <TabBody>; two-pane tabs can manage their own scrolling).
 *
 * tabs: [{ id, label, icon, section? }] — consecutive tabs sharing a
 * `section` are grouped under that heading.
 * `bodyProps` are spread onto the content container.
 */
export default function TabbedModal({
  onClose, title, subtitle, icon,
  tabs, active, onChange,
  width = 880, height = 'min(720px, 100%)',
  bodyProps, children,
}) {
  const { isMobile } = useMobile();

  // Group consecutive tabs by section, keeping their order
  const groups = [];
  for (const tab of tabs) {
    const last = groups[groups.length - 1];
    if (last && last.section === tab.section) last.tabs.push(tab);
    else groups.push({ section: tab.section, tabs: [tab] });
  }

  return (
    <Modal onClose={onClose} title={title} subtitle={subtitle} icon={icon} width={width} height={height}>
      <div className="ui-tabbed" data-mobile={isMobile}>
        <nav className={isMobile ? 'ui-tabbed-nav no-scrollbar' : 'ui-tabbed-nav'} role="tablist" aria-orientation={isMobile ? 'horizontal' : 'vertical'}>
          {groups.map((group, i) => (
            <div key={group.section ?? i} className="ui-tabbed-group">
              {group.section && !isMobile && <div className="ui-tab-section">{group.section}</div>}
              {group.tabs.map(({ id, icon: Icon, label }) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={id === active}
                  className="ui-tab"
                  data-active={id === active}
                  onClick={() => onChange(id)}
                >
                  {Icon && <Icon size={16} style={{ flexShrink: 0 }} />}
                  <span>{label}</span>
                </button>
              ))}
            </div>
          ))}
        </nav>

        <div className="ui-tabbed-body" role="tabpanel" {...bodyProps}>
          {children}
        </div>
      </div>
    </Modal>
  );
}

/** Scrollable, padded content area for a TabbedModal tab. */
export function TabBody({ children, style }) {
  return <div className="ui-tab-body" style={style}>{children}</div>;
}
