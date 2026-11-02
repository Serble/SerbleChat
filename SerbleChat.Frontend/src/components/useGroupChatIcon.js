import { useState, useEffect } from 'react';
import { getGroupChatIconUrl } from '../api.js';
import { withQuery } from '../imageVersions.js';

function versionFor(event, channelId) {
  return event && String(event.channelId) === String(channelId) ? event.ts : 0;
}

/**
 * Tracks whether a group chat has a custom icon and the URL to show it with.
 * Group icons live at a fixed URL, so existence is probed by loading the image;
 * a ChannelUpdated event for this channel cache-busts the URL and re-probes.
 *
 * Returns { hasIcon, src, onError } — pass onError to the <img> so a broken
 * image falls back to the placeholder.
 */
export default function useGroupChatIcon(channelId, channelUpdatedEvent) {
  const [version, setVersion] = useState(() => versionFor(channelUpdatedEvent, channelId));
  const [hasIcon, setHasIcon] = useState(false);

  // Only events for *this* channel bump the version; other channels' updates
  // shouldn't re-download our icon.
  useEffect(() => {
    const v = versionFor(channelUpdatedEvent, channelId);
    if (v) setVersion(v);
  }, [channelUpdatedEvent, channelId]);

  const src = version ? withQuery(getGroupChatIconUrl(channelId), 't=' + version) : getGroupChatIconUrl(channelId);

  useEffect(() => {
    let cancelled = false;
    const img = new Image();
    img.onload = () => { if (!cancelled) setHasIcon(true); };
    img.onerror = () => { if (!cancelled) setHasIcon(false); };
    img.src = src;
    return () => { cancelled = true; img.onload = img.onerror = null; };
  }, [src]);

  return { hasIcon, src, onError: () => setHasIcon(false) };
}
