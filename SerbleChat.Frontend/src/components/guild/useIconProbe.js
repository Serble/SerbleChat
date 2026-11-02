import { useState, useEffect, useCallback } from 'react';
import { withQuery } from '../../imageVersions.js';

/**
 * Guild/channel icons live at a fixed URL that 404s when no icon is set, so we
 * probe it with an off-screen Image before rendering an <img>.
 *
 * `updatedEvent` is a `{ [idKey]: id, ts }` SignalR signal from AppContext
 * (guildUpdatedEvent / channelUpdatedEvent). When it targets this entity the
 * icon is re-probed with a cache-busting `?t=` so uploads/removals show up
 * immediately; events for other entities are ignored.
 *
 * Returns [src | null, markMissing] — pass markMissing to the <img> onError.
 */
export default function useIconProbe(baseUrl, updatedEvent, idKey, id) {
  const refreshTs = updatedEvent && String(updatedEvent[idKey]) === String(id) ? updatedEvent.ts : 0;
  const [version, setVersion] = useState(refreshTs);
  useEffect(() => { if (refreshTs) setVersion(refreshTs); }, [refreshTs]);

  const src = version ? withQuery(baseUrl, `t=${version}`) : baseUrl;
  const [exists, setExists] = useState(false);

  useEffect(() => {
    // Ignore a slow probe that resolves after a newer one has started
    let cancelled = false;
    const img = new Image();
    img.onload  = () => { if (!cancelled) setExists(true); };
    img.onerror = () => { if (!cancelled) setExists(false); };
    img.src = src;
    return () => { cancelled = true; };
  }, [src]);

  const markMissing = useCallback(() => setExists(false), []);
  return [exists ? src : null, markMissing];
}
