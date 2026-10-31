import { Toggle } from './controls.jsx';

/** Uppercase section heading with a divider. `action` renders on the right. */
export function SectionTitle({ children, action, style }) {
  return (
    <div className="ui-section-title" style={style}>
      <span>{children}</span>
      {action}
    </div>
  );
}

export function Card({ children, style }) {
  return <div className="ui-card" style={style}>{children}</div>;
}

export function Hint({ children, style }) {
  return <div className="ui-hint" style={style}>{children}</div>;
}

/**
 * A labelled setting: title + optional description on the left, a control on
 * the right (toggle, number input, …).
 */
export function SettingRow({ title, description, control, children, style }) {
  return (
    <div style={{ marginBottom: '1.5rem', ...style }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-primary)' }}>{title}</div>
          {description && <div className="ui-hint" style={{ marginTop: '0.2rem' }}>{description}</div>}
        </div>
        {control}
      </div>
      {children}
    </div>
  );
}

/** Convenience SettingRow with a Toggle as its control. */
export function ToggleRow({ title, description, checked, onChange, disabled, toggleTitle, children }) {
  return (
    <SettingRow
      title={title}
      description={description}
      control={<Toggle checked={checked} onChange={onChange} disabled={disabled} title={toggleTitle} />}
    >
      {children}
    </SettingRow>
  );
}

/**
 * Selectable card with a radio dot (or a toggle when indicator="toggle").
 * Used for "pick one of these modes" style settings.
 */
export function OptionCard({ selected, onSelect, icon: Icon, label, badge, description, indicator = 'radio' }) {
  return (
    <button
      type="button"
      className="ui-option"
      data-selected={!!selected}
      onClick={onSelect}
      role={indicator === 'radio' ? 'radio' : 'switch'}
      aria-checked={!!selected}
    >
      {indicator === 'toggle'
        ? <Toggle checked={selected} style={{ marginTop: 1 }} />
        : <span className="ui-radio" data-on={!!selected} />}
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          {Icon && <Icon size={15} />}
          <span style={{
            fontSize: '0.875rem', fontWeight: 600,
            color: selected ? 'var(--text-primary)' : 'var(--text-secondary)',
          }}>
            {label}
          </span>
          {badge && <span className="ui-badge">{badge}</span>}
        </span>
        {description && <span className="ui-hint" style={{ display: 'block', marginTop: '0.15rem' }}>{description}</span>}
      </span>
    </button>
  );
}

/** Vertical stack of OptionCards where exactly one value is selected. */
export function OptionGroup({ options, value, onChange, gap = '0.5rem' }) {
  return (
    <div role="radiogroup" style={{ display: 'flex', flexDirection: 'column', gap }}>
      {options.map(opt => (
        <OptionCard
          key={opt.value}
          selected={value === opt.value}
          onSelect={() => onChange(opt.value)}
          icon={opt.icon}
          label={opt.label}
          badge={opt.badge}
          description={opt.description}
        />
      ))}
    </div>
  );
}
