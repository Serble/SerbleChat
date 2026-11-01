import { useId } from 'react';
import { STATUS_META } from './status.js';

/**
 * Status indicator. Each status has its own shape as well as colour, so it
 * reads without colour vision: a filled dot (online), a crescent (away),
 * a dot with a bar (do not disturb), and a ring (offline / invisible).
 *
 * `ring` draws a border in that colour around the dot, for overlaying an avatar
 * (pass the background it sits on).
 */
export default function StatusDot({ presence = 'offline', size = 10, ring, title, style }) {
  // Strip the punctuation useId adds, so the id is safe inside url(#…)
  const maskId = 'sd' + useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const meta = STATUS_META[presence] ?? STATUS_META.offline;
  const ringWidth = ring ? Math.max(2, Math.round(size / 5)) : 0;

  // Cut-outs in a 10×10 box; white keeps, black removes
  let cutout = null;
  if (presence === 'away') cutout = <circle cx="2.6" cy="2.6" r="3.6" fill="black" />;
  else if (presence === 'dnd') cutout = <rect x="2" y="3.9" width="6" height="2.2" rx="1.1" fill="black" />;
  else if (presence === 'offline' || presence === 'invisible') cutout = <circle cx="5" cy="5" r="2.4" fill="black" />;

  return (
    <span
      // title="" marks it decorative (the status is named next to it)
      title={title === '' ? undefined : (title ?? meta.label)}
      role={title === '' ? undefined : 'img'}
      aria-label={title === '' ? undefined : (title ?? meta.label)}
      aria-hidden={title === '' ? true : undefined}
      style={{
        display: 'inline-flex', flexShrink: 0, borderRadius: '50%',
        background: ring, padding: ringWidth,
        ...style,
      }}
    >
      <svg width={size} height={size} viewBox="0 0 10 10" style={{ display: 'block' }}>
        {cutout && (
          <mask id={maskId}>
            <rect width="10" height="10" fill="white" />
            {cutout}
          </mask>
        )}
        <circle cx="5" cy="5" r="5" fill={meta.color} mask={cutout ? `url(#${maskId})` : undefined} />
      </svg>
    </span>
  );
}

/** A StatusDot pinned to the bottom-right of an avatar. Wrap both in a position: relative box. */
export function AvatarStatusDot({ presence, size = 10, ring = 'var(--bg-secondary)' }) {
  const ringWidth = Math.max(2, Math.round(size / 5));
  return (
    <StatusDot
      presence={presence}
      size={size}
      ring={ring}
      style={{ position: 'absolute', right: -ringWidth, bottom: -ringWidth }}
    />
  );
}
