import { useState, useEffect, useLayoutEffect, useRef, useMemo } from 'react';
import Avatar from '../Avatar.jsx';
import { MessageBubble, BlockedGroupBubble } from './MessageBubble.jsx';
import { markMessagesAsRead } from '../../api.js';
import { parseUtcDate, senderKey } from './utils.js';
import { HashIcon, PeopleIcon, ArrowDownIcon } from '../../icons.jsx';
import { useDateFormat, formatDateLong } from '../../dateFormat.js';
import './chat.css';

// Consecutive messages from the same author within this window are grouped
const GROUP_WINDOW_MS = 5 * 60 * 1000;
// Start fetching the next page when the user is within this distance of either end of the loaded history
const LOAD_PAGE_THRESHOLD_PX = 600;
// Beyond this distance from the bottom the user counts as "reading history"
const AWAY_FROM_BOTTOM_PX = 80;
const HIGHLIGHT_MS = 2400;

/**
 * Note where the message nearest the middle of the view sits, so the view can be put back exactly there
 * after messages are added or dropped around it. Returns a scroll intent for MessageList, or null.
 */
export function captureScrollAnchor(scroller) {
  if (!scroller) return null;
  const box = scroller.getBoundingClientRect();
  const mid = box.top + box.height / 2;
  let best = null;
  let bestDist = Infinity;
  for (const el of scroller.querySelectorAll('[data-msgid]')) {
    const r = el.getBoundingClientRect();
    if (r.bottom < box.top || r.top > box.bottom) continue;
    const dist = r.top <= mid && r.bottom >= mid ? 0 : Math.min(Math.abs(r.top - mid), Math.abs(r.bottom - mid));
    if (dist < bestDist) {
      best = el;
      bestDist = dist;
      if (dist === 0) break;
    }
  }
  return best && { type: 'anchor', id: best.getAttribute('data-msgid'), top: best.getBoundingClientRect().top };
}

function dayKey(d) {
  return d.getFullYear() * 10000 + d.getMonth() * 100 + d.getDate();
}

function formatDay(d) {
  const today = new Date();
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  if (dayKey(d) === dayKey(today)) return 'Today';
  if (dayKey(d) === dayKey(yesterday)) return 'Yesterday';
  return formatDateLong(d, { year: d.getFullYear() !== today.getFullYear() });
}

/**
 * Turn the flat message list into render units: day dividers, single messages
 * (flagged `grouped` when they continue the previous author's run) and
 * collapsed runs of blocked-user messages.
 */
function buildUnits(messages, isBlocked, blockedMode) {
  const units = [];
  let lastDay = null;
  let prev = null; // last message rendered as a normal row, for grouping

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    const blocked = !msg._pending && msg.authorId != null && isBlocked(msg.authorId);
    if (blocked && blockedMode === 'hidden') continue;

    const date = parseUtcDate(msg.createdAt);
    const day = isNaN(date) ? lastDay : dayKey(date);
    if (day !== lastDay) {
      // Keyed by the message it precedes (not the day): when older messages from the same day
      // load, a fresh divider goes above them instead of this one staying put at the top
      units.push({ type: 'divider', key: `day-${msg._key ?? msg.id}`, date });
      lastDay = day;
      prev = null;
    }

    if (blocked && blockedMode !== 'visible') {
      // 'masked' (default): collapse consecutive blocked messages from the same author
      const group = [msg];
      while (i + 1 < messages.length) {
        const next = messages[i + 1];
        if (next._pending || next.authorId !== msg.authorId) break;
        const nextDate = parseUtcDate(next.createdAt);
        if (!isNaN(nextDate) && dayKey(nextDate) !== lastDay) break;
        group.push(next);
        i++;
      }
      units.push({ type: 'blocked', key: `blocked-${msg.id}`, authorId: msg.authorId, messages: group });
      prev = null;
      continue;
    }

    const grouped = !!prev && senderKey(prev) === senderKey(msg) &&
      date - parseUtcDate(prev.createdAt) < GROUP_WINDOW_MS;
    units.push({ type: 'message', key: msg._key ?? msg.id, msg, grouped });
    prev = msg;
  }
  return units;
}

function DayDivider({ date }) {
  useDateFormat();  // re-render when the date format changes
  return (
    <div className="msg-divider" role="separator">
      <span>{formatDay(date)}</span>
    </div>
  );
}

/** Shown above the first message once the whole history is loaded. */
function ChannelIntro({ channel, displayName, otherUser }) {
  let icon, title, text;
  if (channel?.type === 1) {
    icon = <Avatar userId={otherUser?.id} name={otherUser?.username} size={72} color={otherUser?.color} />;
    title = displayName;
    text = <>This is the beginning of your direct message history with <strong>{displayName}</strong>.</>;
  } else if (channel?.type === 2) {
    icon = <div className="msg-intro-icon"><PeopleIcon size={34} /></div>;
    title = displayName;
    text = <>Welcome to the beginning of the <strong>{displayName}</strong> group.</>;
  } else {
    icon = <div className="msg-intro-icon"><HashIcon size={34} /></div>;
    title = `Welcome to #${displayName}!`;
    text = <>This is the start of the <strong>#{displayName}</strong> channel.</>;
  }
  return (
    <div className="msg-intro">
      {icon}
      <div className="msg-intro-title">{title}</div>
      <div className="msg-intro-text">{text}</div>
    </div>
  );
}

function Spinner() {
  return <span className="msg-spinner" aria-hidden="true" />;
}

/** Placeholder rows shown while a channel's first page loads. */
export function MessageListSkeleton() {
  const rows = [[0.35, 0.8], [0.25, 0.55], [0.3, 0.7, 0.4], [0.2, 0.45], [0.3, 0.9, 0.6]];
  return (
    <div className="msg-skeleton" aria-busy="true" aria-label="Loading messages">
      {rows.map((lines, i) => (
        <div key={i} className="msg-skeleton-row">
          <div className="msg-skeleton-avatar" />
          <div style={{ flex: 1 }}>
            {lines.map((w, j) => (
              <div key={j} className={j === 0 ? 'msg-skeleton-line msg-skeleton-line--name' : 'msg-skeleton-line'} style={{ width: `${w * 100}%` }} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * The scrolling message history for a channel.
 *
 * The scroller uses flex-direction: column-reverse, so the browser keeps the
 * view pinned to the bottom as messages arrive or embeds load, and prepending
 * older history doesn't move what's on screen. In that layout scrollTop is 0
 * at the bottom and goes negative as the user scrolls up.
 */
export default function MessageList({
  scrollRef, channel, channelId, displayName, otherUser, messages,
  hasOlder, hasNewer, loadingOlder, loadingNewer, pageError,
  onLoadOlder, onLoadNewer, onLoadAround, onJumpToPresent, scrollIntentRef, jumpToId, onJumpHandled,
  isBlocked, blockedMessageMode, currentUserId, editingMsgId, activeMsgId, bubbleProps,
}) {
  const [highlightId, setHighlightId] = useState(null);
  const [jumpState, setJumpState] = useState(null); // 'searching' | 'notfound' | null
  const [farFromBottom, setFarFromBottom] = useState(false);
  // Id of the newest message when the user scrolled away from the bottom (null while at the bottom)
  const [awayAnchor, setAwayAnchor] = useState(null);
  // The linked message we've already loaded the history around (so a missing one is reported, not refetched)
  const [loadedAround, setLoadedAround] = useState(null);
  const aroundRequestedRef = useRef(null);
  const lastMarkedReadIdRef = useRef(null);
  const markReadTimeoutRef = useRef(null);

  const units = useMemo(
    () => buildUnits(messages, isBlocked, blockedMessageMode),
    [messages, isBlocked, blockedMessageMode]
  );

  // Messages that arrived (from others) since the user scrolled up
  const newCount = useMemo(() => {
    if (awayAnchor === null) return 0;
    const idx = messages.findIndex(m => String(m.id) === awayAnchor);
    if (idx === -1) return 0;
    return messages.slice(idx + 1).filter(m => !m._pending && m.authorId !== currentUserId).length;
  }, [messages, awayAnchor, currentUserId]);

  function newestMessageId() {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (!messages[i]._pending) return String(messages[i].id);
    }
    return '';
  }

  function checkNearEdges() {
    const el = scrollRef.current;
    if (!el) return;
    const distanceFromTop = el.scrollHeight - el.clientHeight + el.scrollTop;
    if (hasOlder && distanceFromTop < LOAD_PAGE_THRESHOLD_PX) onLoadOlder();
    if (hasNewer && -el.scrollTop < LOAD_PAGE_THRESHOLD_PX) onLoadNewer();
  }

  function handleScroll() {
    const el = scrollRef.current;
    if (!el) return;
    // Wheeling to the bottom can leave Chromium at scrollTop 1 (just past the end). Away from exactly 0, the
    // column-reverse scroller stops sticking to the bottom, and new messages would land below the view.
    if (el.scrollTop > 0 && el.scrollTop < 2) el.scrollTop = 0;
    const fromBottom = -el.scrollTop;
    setFarFromBottom(fromBottom > el.clientHeight);
    if (fromBottom > AWAY_FROM_BOTTOM_PX) {
      if (awayAnchor === null) setAwayAnchor(newestMessageId());
    } else if (awayAnchor !== null) {
      setAwayAnchor(null);
    }
    checkNearEdges();
  }

  async function jumpToPresent() {
    const el = scrollRef.current;
    if (!el) return;
    // Away from the present, the newest messages have to be loaded first; that lands at the bottom
    if (hasNewer) {
      setJumpState('searching');
      const ok = await onJumpToPresent();
      setJumpState(ok ? null : 'notfound');
      return;
    }
    // Smooth-scrolling through a long history is slow; skip to the last screenful first
    if (-el.scrollTop > el.clientHeight * 2) el.scrollTop = -el.clientHeight;
    el.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // Hold the view in place across a page landing (or snap to the bottom after going to the present).
  // A layout effect, so the correction happens before the browser paints the changed list.
  useLayoutEffect(() => {
    const intent = scrollIntentRef.current;
    if (!intent) return;
    scrollIntentRef.current = null;
    const el = scrollRef.current;
    if (!el) return;
    if (intent.type === 'bottom') {
      el.scrollTop = 0;
      return;
    }
    const target = el.querySelector(`[data-msgid="${CSS.escape(intent.id)}"]`);
    if (!target) return;
    // In the column-reverse scroller, raising scrollTop moves the content up
    const delta = target.getBoundingClientRect().top - intent.top;
    if (Math.abs(delta) >= 0.5) el.scrollTop += delta;
  }, [messages]); // eslint-disable-line react-hooks/exhaustive-deps

  // Scrolling isn't the only way an end of the loaded history can end up on screen: the first page, a
  // short page, or hidden blocked messages may not fill the viewport. Re-check whenever the list changes.
  useEffect(() => {
    checkNearEdges();
  }, [units, loadingOlder, loadingNewer, hasOlder, hasNewer, pageError]); // eslint-disable-line react-hooks/exhaustive-deps

  // Jump to a linked message: scroll to it if it's loaded, otherwise load the history around it first.
  // A layout effect, so a freshly loaded window is scrolled into place before it's ever painted.
  useLayoutEffect(() => {
    if (!jumpToId) return;
    const id = String(jumpToId);
    const scroller = scrollRef.current;
    const el = scroller?.querySelector(`[data-msgid="${CSS.escape(id)}"]`);
    if (el) {
      aroundRequestedRef.current = null;
      setJumpState(null);
      // Smooth-scroll short hops; jump straight to far-away (e.g. freshly loaded) messages
      const offset = el.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
      const far = loadedAround === id || Math.abs(offset) > scroller.clientHeight * 2;
      el.scrollIntoView({ behavior: far ? 'auto' : 'smooth', block: 'center' });
      setHighlightId(id);
      onJumpHandled();
      return;
    }
    if (aroundRequestedRef.current !== id) {
      aroundRequestedRef.current = id;
      setJumpState('searching');
      onLoadAround(id).then(ok => {
        if (aroundRequestedRef.current !== id) return;
        if (ok) setLoadedAround(id);
        else {
          aroundRequestedRef.current = null;
          setJumpState('notfound');
          onJumpHandled();
        }
      });
      return;
    }
    if (loadedAround === id) {
      // The history around it is loaded and it isn't there: deleted, or from a hidden blocked user.
      // Show where it would have been.
      const target = Number(id);
      const near = [...(scroller?.querySelectorAll('[data-msgid]') ?? [])]
        .find(e => Number(e.getAttribute('data-msgid')) >= target);
      if (near) near.scrollIntoView({ block: 'center' });
      else if (scroller) scroller.scrollTop = 0;
      aroundRequestedRef.current = null;
      setLoadedAround(null);
      setJumpState('notfound');
      onJumpHandled();
    }
  }, [jumpToId, units, loadedAround]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!highlightId) return;
    const t = setTimeout(() => setHighlightId(null), HIGHLIGHT_MS);
    return () => clearTimeout(t);
  }, [highlightId]);

  useEffect(() => {
    if (jumpState !== 'notfound') return;
    const t = setTimeout(() => setJumpState(null), 3000);
    return () => clearTimeout(t);
  }, [jumpState]);

  // Mark visible messages as read as the user views them
  useEffect(() => {
    const scrollEl = scrollRef.current;
    if (!scrollEl || messages.length === 0) return;

    const markVisibleMessagesAsRead = () => {
      const scrollRect = scrollEl.getBoundingClientRect();
      let highestVisibleId = null;

      for (const el of scrollEl.querySelectorAll('[data-msgid]')) {
        const rect = el.getBoundingClientRect();
        if (rect.bottom <= scrollRect.top || rect.top >= scrollRect.bottom) continue;
        const msgId = el.getAttribute('data-msgid');
        if (!msgId || !/^\d+$/.test(msgId)) continue;
        const id = BigInt(msgId);
        if (highestVisibleId === null || id > highestVisibleId) highestVisibleId = id;
      }
      if (highestVisibleId === null) return;

      const lastMarked = lastMarkedReadIdRef.current ? BigInt(lastMarkedReadIdRef.current) : null;
      if (lastMarked !== null && highestVisibleId <= lastMarked) return;
      // Debounce the API call to avoid too many requests
      clearTimeout(markReadTimeoutRef.current);
      markReadTimeoutRef.current = setTimeout(async () => {
        try {
          await markMessagesAsRead(String(channelId), String(highestVisibleId));
          lastMarkedReadIdRef.current = String(highestVisibleId);
        } catch (err) {
          console.warn('Failed to mark messages as read:', err);
        }
      }, 500);
    };

    scrollEl.addEventListener('scroll', markVisibleMessagesAsRead);
    markVisibleMessagesAsRead();
    return () => {
      scrollEl.removeEventListener('scroll', markVisibleMessagesAsRead);
      clearTimeout(markReadTimeoutRef.current);
    };
  }, [messages, channelId]); // eslint-disable-line react-hooks/exhaustive-deps

  const showJumpPill = farFromBottom || newCount > 0 || hasNewer;

  return (
    <div className="msg-list-wrap">
      <div ref={scrollRef} className="msg-scroller" onScroll={handleScroll}>
        <div className="msg-list">
          {hasOlder ? (
            <div className="msg-loading-older" style={{ visibility: loadingOlder || pageError === 'older' ? 'visible' : 'hidden' }}>
              {pageError === 'older'
                ? "Couldn't load older messages. Retrying…"
                : <><Spinner /> Loading older messages…</>}
            </div>
          ) : (
            <ChannelIntro channel={channel} displayName={displayName} otherUser={otherUser} />
          )}

          {units.map(unit => {
            if (unit.type === 'divider') return <DayDivider key={unit.key} date={unit.date} />;
            if (unit.type === 'blocked') {
              return (
                <BlockedGroupBubble
                  key={unit.key}
                  {...bubbleProps}
                  messages={unit.messages}
                  authorId={unit.authorId}
                  currentUserId={currentUserId}
                />
              );
            }
            const id = String(unit.msg.id);
            return (
              <MessageBubble
                key={unit.key}
                {...bubbleProps}
                msg={unit.msg}
                grouped={unit.grouped}
                currentUserId={currentUserId}
                highlighted={highlightId === id}
                active={activeMsgId != null && String(activeMsgId) === id}
                isEditing={editingMsgId !== null && String(editingMsgId) === id}
              />
            );
          })}
          {hasNewer && (
            <div className="msg-loading-older msg-loading-newer" style={{ visibility: loadingNewer || pageError === 'newer' ? 'visible' : 'hidden' }}>
              {pageError === 'newer'
                ? "Couldn't load newer messages. Retrying…"
                : <><Spinner /> Loading newer messages…</>}
            </div>
          )}
          <div className="msg-list-end" />
        </div>
      </div>

      {jumpState && (
        <div className="msg-toast" role="status">
          {jumpState === 'searching'
            ? <><Spinner /> Loading messages…</>
            : "Couldn't find that message"}
        </div>
      )}

      {showJumpPill && !jumpState && (
        <button type="button" className="msg-jump" onClick={jumpToPresent}>
          {newCount > 0
            ? `${newCount} new message${newCount === 1 ? '' : 's'}`
            : 'Jump to present'}
          <ArrowDownIcon size={14} />
        </button>
      )}
    </div>
  );
}
