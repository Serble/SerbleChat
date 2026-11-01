import { useEffect, useMemo } from 'react';
import { useApp } from '../../context/AppContext.jsx';
import { isPollEnded, useNow } from './pollUtils.js';

/**
 * A channel's polls that are still taking votes, newest first. Fetches them once
 * per mount (they may be far up the history); live events keep them current after.
 */
export function useActivePolls(channelId, { fetch = true } = {}) {
  const { polls, loadActivePolls } = useApp();
  const key = channelId == null ? null : String(channelId);

  useEffect(() => {
    if (fetch && key) loadActivePolls(key);
  }, [key, fetch, loadActivePolls]);

  const candidates = useMemo(() => (
    key == null ? [] : Object.values(polls)
      .filter(p => String(p.channelId) === key && !p.closedAt)
      .sort((a, b) => b.id - a.id)
  ), [polls, key]);

  // Tick while any of them has a deadline, so expired ones drop out on time
  const now = useNow(candidates.some(p => p.expiresAt != null));
  return useMemo(() => candidates.filter(p => !isPollEnded(p, now)), [candidates, now]);
}
