import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import Avatar from '../Avatar.jsx';
import { searchMessages } from '../../api.js';
import { MentionText } from './MentionRenderer.jsx';
import { mdComponents } from './markdown.jsx';
import { parseSearchTerms, parseUtcDate, isWebhookMessage, webhookAvatarSrc } from './utils.js';
import { useDateFormat, formatDate, formatTime, formatDateLong } from '../../dateFormat.js';
import { SearchIcon, CloseIcon, ChevronLeftIcon, BlockIcon } from '../../icons.jsx';
import './chat.css';

const DEBOUNCE_MS = 300;
const PAGE = 25;
// Fetch the next page once the user scrolls within this distance of the end of the results
const LOAD_MORE_PX = 300;

/** One search hit: author, time and the message with the matched terms marked. Click to jump to it. */
const SearchResult = React.memo(function SearchResult({
  msg, terms, selected, masked, onJump, peekUser, resolveUser, getColor, mentionData,
}) {
  useDateFormat();
  const [author, setAuthor] = useState(() => (msg.authorId ? peekUser?.(msg.authorId) : null) ?? null);
  const [revealed, setRevealed] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!msg.authorId) return;
    let cancelled = false;
    resolveUser(msg.authorId).then(u => { if (!cancelled) setAuthor(u); });
    return () => { cancelled = true; };
  }, [msg.authorId, resolveUser]);
  useEffect(() => {
    if (selected) ref.current?.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  const webhook = isWebhookMessage(msg);
  const name = webhook ? (msg.webhookUsername ?? 'Webhook') : (author?.username ?? '…');
  const color = webhook ? undefined : getColor?.(msg.authorId, author?.username, author?.color);
  const date = parseUtcDate(msg.createdAt);
  const when = isNaN(date) ? '' : `${formatDate(date)} ${formatTime(date)}`;
  const hidden = masked && !revealed;

  return (
    <div
      ref={ref}
      role="option"
      aria-selected={selected}
      tabIndex={-1}
      className="search-result"
      data-selected={selected}
      onClick={() => { if (!hidden) onJump(msg); }}
    >
      <div className="search-result-head">
        {webhook
          ? <Avatar name={name} size={24} src={webhookAvatarSrc(msg)} />
          : <Avatar userId={msg.authorId} name={name} size={24} color={author?.color} />}
        <span className="search-result-name" style={color ? { color } : undefined}>{name}</span>
        <span className="search-result-time" title={isNaN(date) ? undefined : `${formatDateLong(date)}, ${formatTime(date)}`}>{when}</span>
        {!hidden && <span className="search-result-jump">Jump</span>}
      </div>
      {hidden ? (
        <div className="search-result-blocked">
          <BlockIcon size={13} style={{ flexShrink: 0 }} />
          <span>Message from a blocked user</span>
          <button type="button" className="msg-blocked-toggle" onClick={e => { e.stopPropagation(); setRevealed(true); }}>Show</button>
        </div>
      ) : (
        <div className="search-result-body">
          <MentionText
            content={msg.content}
            mdComponents={mdComponents}
            mentionData={mentionData}
            resolveUser={resolveUser}
            highlightTerms={terms}
          />
          {msg.poll && <div className="search-result-poll">Poll: {msg.poll.question}</div>}
        </div>
      )}
    </div>
  );
});

/**
 * Message search for one channel, shown beside the chat (or over it on phones).
 * `focusToken` changes whenever the search box should take focus again (e.g. Ctrl+F while it's open).
 */
export default function SearchPanel({
  channelId, channelLabel, focusToken, onJump, onClose, isMobile,
  peekUser, resolveUser, getColor, mentionData, isBlocked, blockedMessageMode,
}) {
  const [query, setQuery] = useState('');
  // The query the shown results are for, and its terms (for highlighting)
  const [searched, setSearched] = useState('');
  const [results, setResults] = useState([]);
  const [total, setTotal] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const [status, setStatus] = useState('idle'); // idle | loading | done | error
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState(false);
  const [selected, setSelected] = useState(-1);
  const inputRef = useRef(null);
  const listRef = useRef(null);
  // The in-flight request for the current query; replaced (and aborted) on every new search
  const requestRef = useRef(null);

  const terms = useMemo(() => parseSearchTerms(searched), [searched]);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [focusToken]);

  const runSearch = useCallback(async (q) => {
    requestRef.current?.abort();
    const trimmed = q.trim();
    if (!trimmed || parseSearchTerms(trimmed).length === 0) {
      requestRef.current = null;
      setSearched(''); setResults([]); setTotal(null); setHasMore(false); setStatus('idle'); setSelected(-1);
      return;
    }
    const ctrl = new AbortController();
    requestRef.current = ctrl;
    setStatus('loading');
    setMoreError(false);
    try {
      const res = await searchMessages(channelId, { q: trimmed, limit: PAGE }, ctrl.signal);
      if (requestRef.current !== ctrl) return;
      setSearched(trimmed);
      setResults(res.messages ?? []);
      setTotal(res.totalCount ?? null);
      setHasMore(!!res.hasMore);
      setSelected(-1);
      setStatus('done');
      listRef.current?.scrollTo({ top: 0 });
    } catch (err) {
      if (ctrl.signal.aborted || requestRef.current !== ctrl) return;
      console.error('Search failed:', err);
      setStatus('error');
    }
  }, [channelId]);

  // Search as the user types, once they pause
  useEffect(() => {
    setSelected(-1);
    const t = setTimeout(() => runSearch(query), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [query, runSearch]);

  useEffect(() => () => requestRef.current?.abort(), []);

  async function loadMore() {
    const ctrl = requestRef.current;
    const last = results[results.length - 1];
    if (!ctrl || !hasMore || loadingMore || status !== 'done' || !last) return;
    setLoadingMore(true);
    setMoreError(false);
    try {
      const res = await searchMessages(channelId, { q: searched, before: last.id, limit: PAGE }, ctrl.signal);
      if (requestRef.current !== ctrl) return;
      setResults(prev => {
        const known = new Set(prev.map(m => String(m.id)));
        return [...prev, ...(res.messages ?? []).filter(m => !known.has(String(m.id)))];
      });
      setHasMore(!!res.hasMore);
    } catch (err) {
      if (ctrl.signal.aborted || requestRef.current !== ctrl) return;
      console.error('Loading more search results failed:', err);
      setMoreError(true);
    } finally {
      if (requestRef.current === ctrl) setLoadingMore(false);
    }
  }

  function handleListScroll() {
    const el = listRef.current;
    if (el && !moreError && el.scrollHeight - el.scrollTop - el.clientHeight < LOAD_MORE_PX) loadMore();
  }

  // A short first page may not fill the panel, leaving nothing to scroll: keep loading until it does
  useEffect(() => {
    if (status === 'done' && hasMore && !loadingMore && !moreError) handleListScroll();
  }, [results, status, hasMore, loadingMore]); // eslint-disable-line react-hooks/exhaustive-deps

  // Hidden blocked users' messages aren't shown at all; masked ones are collapsed until revealed
  const shown = useMemo(() => results.filter(m =>
    !(blockedMessageMode === 'hidden' && m.authorId && isBlocked(m.authorId))
  ), [results, blockedMessageMode, isBlocked]);

  function handleKeyDown(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    } else if (e.key === 'ArrowDown' && shown.length > 0) {
      e.preventDefault();
      setSelected(i => Math.min(shown.length - 1, i + 1));
    } else if (e.key === 'ArrowUp' && shown.length > 0) {
      e.preventDefault();
      setSelected(i => Math.max(-1, i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      // Results still for an earlier query (typed faster than the debounce): search now, don't jump
      if (query.trim() !== searched || status !== 'done') runSearch(query);
      else if (selected >= 0 && shown[selected]) onJump(shown[selected]);
    }
  }

  const countLabel = total != null
    ? `${total.toLocaleString()} result${total === 1 ? '' : 's'}`
    : `${shown.length}${hasMore ? '+' : ''} results`;

  return (
    <div className={isMobile ? 'search-panel search-panel--mobile' : 'search-panel'} role="search">
      <div className="search-panel-head">
        {isMobile && (
          <button type="button" className="chat-header-btn" title="Back" aria-label="Close search" onClick={onClose}>
            <ChevronLeftIcon size={18} />
          </button>
        )}
        <div className="search-box">
          <SearchIcon size={15} />
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={`Search ${channelLabel}`}
            aria-label="Search messages"
            aria-controls="search-results"
            spellCheck={false}
            enterKeyHint="search"
          />
          {query && (
            <button
              type="button"
              className="search-box-clear"
              title="Clear"
              aria-label="Clear search"
              onClick={() => { setQuery(''); inputRef.current?.focus(); }}
            >
              <CloseIcon size={13} />
            </button>
          )}
        </div>
        {!isMobile && (
          <button type="button" className="chat-header-btn" title="Close search (Esc)" aria-label="Close search" onClick={onClose}>
            <CloseIcon size={16} />
          </button>
        )}
      </div>

      {status === 'done' && (
        <div className="search-panel-count" aria-live="polite">{countLabel}</div>
      )}

      <div ref={listRef} id="search-results" role="listbox" className="search-panel-list" onScroll={handleListScroll}>
        {status === 'idle' && (
          <div className="search-panel-hint">
            <SearchIcon size={28} />
            <p>Search the messages in {channelLabel}.</p>
            <p className="search-panel-tip">Every word has to match. Put a phrase in <code>"quotes"</code> to find it exactly.</p>
          </div>
        )}
        {status === 'loading' && (
          <div className="search-panel-status"><span className="msg-spinner" aria-hidden="true" /> Searching…</div>
        )}
        {status === 'error' && (
          <div className="search-panel-status">
            Search failed.
            <button type="button" className="msg-show-more" onClick={() => runSearch(query)}>Try again</button>
          </div>
        )}
        {status === 'done' && shown.length === 0 && (
          <div className="search-panel-status">No messages match <strong>{searched}</strong>.</div>
        )}
        {status === 'done' && shown.map((m, i) => (
          <SearchResult
            key={m.id}
            msg={m}
            terms={terms}
            selected={i === selected}
            masked={blockedMessageMode === 'masked' && !!m.authorId && isBlocked(m.authorId)}
            onJump={onJump}
            peekUser={peekUser}
            resolveUser={resolveUser}
            getColor={getColor}
            mentionData={mentionData}
          />
        ))}
        {status === 'done' && (loadingMore || moreError) && (
          <div className="search-panel-status">
            {moreError
              ? <>Couldn't load more. <button type="button" className="msg-show-more" onClick={() => { setMoreError(false); loadMore(); }}>Retry</button></>
              : <><span className="msg-spinner" aria-hidden="true" /> Loading more…</>}
          </div>
        )}
      </div>
    </div>
  );
}
