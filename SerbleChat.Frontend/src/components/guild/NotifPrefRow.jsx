import { BellIcon, ChatIcon, BellOffIcon, InheritIcon } from '../../icons.jsx';

// NotificationPreference enum: Inherit=0, AllMessages=1, MentionsOnly=2, Nothing=3
export const NOTIF_PREF_ICONS = { 0: InheritIcon, 1: BellIcon, 2: ChatIcon, 3: BellOffIcon };

/**
 * Labelled row of pill buttons for picking a NotificationPreference.
 * options: [{ value, label, desc }]
 */
export default function NotifPrefRow({ label, options, value, onChange, busy }) {
  return (
    <div style={{ padding: '0.5rem 0.75rem' }}>
      <div style={{
        fontSize: '0.68rem', fontWeight: 700, color: 'var(--text-muted)',
        textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.3rem',
      }}>{label}</div>
      <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap' }}>
        {options.map(opt => {
          const active = value === opt.value;
          const Icon = NOTIF_PREF_ICONS[opt.value];
          return (
            <button
              key={opt.value}
              type="button"
              title={opt.desc}
              aria-pressed={active}
              disabled={busy}
              onClick={() => onChange(opt.value)}
              className={!active && !busy ? 'hov-bg' : undefined}
              style={{
                display: 'flex', alignItems: 'center', gap: '0.3rem',
                padding: '0.25rem 0.55rem', borderRadius: 6,
                border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
                background: active ? 'var(--accent-soft)' : 'transparent',
                color: active ? 'var(--text-primary)' : 'var(--text-muted)',
                fontSize: '0.78rem', fontWeight: active ? 600 : 400,
                cursor: busy ? 'default' : 'pointer',
                transition: 'background 0.1s, border-color 0.1s, color 0.1s',
              }}
            >
              {Icon && <Icon size={14} />}
              <span>{opt.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Header strip for the notification popup menus. */
export function NotifMenuHeader({ title, subtitle }) {
  return (
    <div style={{ padding: '0.5rem 0.75rem 0.4rem', borderBottom: '1px solid var(--border)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-primary)' }}>
        <BellIcon size={14} /> {title}
      </div>
      {subtitle && (
        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '0.1rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {subtitle}
        </div>
      )}
    </div>
  );
}
