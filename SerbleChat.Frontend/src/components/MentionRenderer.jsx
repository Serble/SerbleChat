import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import { useClientOptions } from '../context/ClientOptionsContext.jsx';

/** Matches <@user:id>, <@channel:id>, <@role:id> */
export const MENTION_RE = /<@(user|channel|role):([^>\s]+)>/g;

// Module-level constant — avoids creating a new array on every render,
// which would force react-markdown to rebuild its unified processor each time.
const REMARK_PLUGINS = [remarkGfm, remarkBreaks];

/**
 * Markdown collapses multiple consecutive blank lines into one paragraph break.
 * Preserve extra blank lines, but cap at 8 extras to prevent thousands of
 * empty paragraphs being generated from messages that are mostly newlines.
 */
function preserveBlankLines(content) {
  return content.replace(/\n{3,}/g, match => {
    const extra = match.length - 2;
    return '\n\n' + '\u200B\n\n'.repeat(extra);
  });
}

// ─── Error boundary ───────────────────────────────────────────────────────────

/**
 * Catches any synchronous error thrown during the remark → HAST → JSX
 * pipeline (including call-stack overflows on malformed/huge content) and
 * falls back to plain pre-wrapped text so the rest of the chat stays intact.
 */
class MarkdownErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { crashed: false }; }
  static getDerivedStateFromError() { return { crashed: true }; }
  componentDidCatch(err) { console.warn('[MarkdownErrorBoundary] caught error:', err?.message); }
  render() {
    if (this.state.crashed) {
      return (
        <span style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
          {this.props.fallback}
        </span>
      );
    }
    return this.props.children;
  }
}

/**
 * Always renders through ReactMarkdown (error boundary catches any crash).
 * Never truncates content — the collapsing is handled at the MentionText level.
 */
function SafeMarkdown({ content, components }) {
  if (!content) return null;
  const safe = preserveBlankLines(content);
  return (
    <MarkdownErrorBoundary key={content} fallback={content}>
      <ReactMarkdown remarkPlugins={REMARK_PLUGINS} components={components}>
        {safe}
      </ReactMarkdown>
    </MarkdownErrorBoundary>
  );
}

// ─── MentionChip ──────────────────────────────────────────────────────────────

export function MentionChip({ type, id, mentionData, resolveUser, onUserClick }) {
  const nav = useNavigate();
  const [label, setLabel] = useState(null);
  const [color, setColor] = useState(null);

  useEffect(() => {
    if (type === 'user') {
      const found = mentionData?.members?.find(m => String(m.id) === String(id));
      if (found) { setLabel(found.username); return; }
      resolveUser?.(id).then(u => setLabel(u?.username ?? id.slice(0, 8)));
    } else if (type === 'channel') {
      const found = mentionData?.channels?.find(c => String(c.id) === String(id));
      setLabel(found?.name ?? `channel-${id}`);
    } else if (type === 'role') {
      const found = mentionData?.roles?.find(r => String(r.id) === String(id));
      setLabel(found?.name ?? `role-${id}`);
      setColor(found?.color || null);
    }
  }, [type, id, mentionData]); // eslint-disable-line react-hooks/exhaustive-deps

  const txt = label ?? '…';

  const base = {
    display: 'inline', borderRadius: '3px',
    padding: '0.05em 0.3em', fontWeight: 600,
    transition: 'background 0.1s', lineHeight: 'inherit',
  };

  if (type === 'user') return (
    <span
      onClick={e => { e.stopPropagation(); onUserClick?.(e, id, label); }}
      style={{ ...base, background: 'rgba(88,101,242,0.2)', color: '#7c9ef8', cursor: 'pointer' }}
      onMouseEnter={e => e.currentTarget.style.background = 'rgba(88,101,242,0.35)'}
      onMouseLeave={e =>  e.currentTarget.style.background = 'rgba(88,101,242,0.2)'}
    >@{txt}</span>
  );

  if (type === 'channel') return (
    <span
      onClick={() => nav(`/app/channel/${id}`)}
      style={{ ...base, background: 'rgba(88,101,242,0.2)', color: '#7c9ef8', cursor: 'pointer' }}
      onMouseEnter={e => e.currentTarget.style.background = 'rgba(88,101,242,0.35)'}
      onMouseLeave={e =>  e.currentTarget.style.background = 'rgba(88,101,242,0.2)'}
    >#{txt}</span>
  );

  if (type === 'role') {
    const bg = color ? `${color}33` : 'rgba(255,255,255,0.08)';
    const fg = color || '#b5bac1';
    return (
      <span style={{ ...base, background: bg, color: fg, cursor: 'default' }}>@{txt}</span>
    );
  }

  return null;
}

// ─── MentionText ─────────────────────────────────────────────────────────────

/**
 * Renders a message string, replacing <@type:id> tokens with MentionChips and
 * passing remaining text through SafeMarkdown.
 *
 * Long messages (raw content > COLLAPSE_THRESHOLD chars) are shown collapsed
 * with a "Show more" button — the full markdown is always rendered, only
 * clipped via CSS so nothing is ever truncated or lost.
 *
 * Wrapped in React.memo so it only re-renders when its own props change.
 */
export const MentionText = React.memo(function MentionText({ content, mdComponents, mentionData, resolveUser, onUserClick, appendNode }) {
  const [expanded, setExpanded] = useState(false);
  const { messageLinesLimit } = useClientOptions() ?? { messageLinesLimit: 28 };
  const collapsedMaxHeight = `${messageLinesLimit * 1.5}em`;

  // Parse mention tokens once per unique content string.
  const parts = useMemo(() => {
    if (!content) return [];
    const re = new RegExp(MENTION_RE.source, 'g');
    const result = [];
    let last = 0, m;
    while ((m = re.exec(content)) !== null) {
      if (m.index > last) result.push({ kind: 'text', value: content.slice(last, m.index) });
      result.push({ kind: 'mention', type: m[1], id: m[2] });
      last = m.index + m[0].length;
    }
    if (last < content.length) result.push({ kind: 'text', value: content.slice(last) });
    return result;
  }, [content]);

  if (!content) return null;
  if (parts.length === 0) return null;

  const isLong = (content.match(/\n/g)?.length ?? 0) >= messageLinesLimit;

  // Index of the last 'text' part — used to decide where to inject inline badge
  const lastTextIdx = appendNode
    ? parts.reduce((acc, p, i) => (p.kind === 'text' ? i : acc), -1)
    : -1;

  /**
   * Returns a modified mdComponents set where the last paragraph is
   * display:'inline' so that appendNode follows it on the same line.
   * A fresh closure is created each call, so the counter always starts at 0.
   */
  function makeInlineLastP(textValue) {
    const total = Math.max(
      1,
      textValue.split(/\n\n+/).filter(s => s.trim().length > 0).length
    );
    let rendered = 0;
    return {
      ...mdComponents,
      p: ({ children }) => {
        rendered++;
        const isLast = rendered >= total;
        return (
          <span style={{ display: isLast ? 'inline' : 'block', margin: isLast ? 0 : '0 0 0.45em' }}>
            {children}
          </span>
        );
      },
    };
  }

  const body = parts.length === 1 && parts[0].kind === 'text'
    ? <SafeMarkdown content={content} components={lastTextIdx === 0 ? makeInlineLastP(content) : mdComponents} />
    : (
      <>
        {parts.map((p, i) =>
          p.kind === 'text'
            ? <SafeMarkdown key={i} content={p.value} components={i === lastTextIdx ? makeInlineLastP(p.value) : mdComponents} />
            : <MentionChip
                key={i}
                type={p.type}
                id={p.id}
                mentionData={mentionData}
                resolveUser={resolveUser}
                onUserClick={onUserClick}
              />
        )}
      </>
    );

  if (!isLong) return <>{body}{appendNode}</>;

  return (
    <div>
      <div style={{
        position: 'relative',
        maxHeight: expanded ? 'none' : collapsedMaxHeight,
        overflowY: expanded ? 'visible' : 'hidden',
      }}>
        {body}
        {!expanded && (
          <div style={{
            position: 'absolute', bottom: 0, left: 0, right: 0,
            height: '3rem',
            background: 'linear-gradient(to bottom, transparent, var(--bg-base))',
            pointerEvents: 'none',
          }} />
        )}
      </div>
      <button
        onClick={() => setExpanded(v => !v)}
        style={{
          marginTop: '0.25rem',
          background: 'none', border: 'none',
          color: 'var(--text-link)', fontSize: '0.8rem', fontWeight: 600,
          cursor: 'pointer', padding: 0,
        }}
      >
        {expanded ? '▲ Show less' : '▼ Show more'}
      </button>
      {appendNode}
    </div>
  );
});

// ─── MentionPicker ────────────────────────────────────────────────────────────

const TYPE_ICON  = { user: '@', channel: '#', role: '◈' };
const TYPE_LABEL = { user: 'User', channel: 'Channel', role: 'Role' };

/**
 * Autocomplete dropdown rendered above the message input.
 * Uses onMouseDown + e.preventDefault() so the textarea never loses focus.
 */
export function MentionPicker({ suggestions, selectedIndex, onSelect, onHoverIndex }) {
  if (!suggestions.length) return null;

  return (
    <div style={{
      position: 'absolute', bottom: '100%', left: 0, right: 0,
      marginBottom: 6, background: '#2b2d31',
      border: '1px solid #3b3d43', borderRadius: '8px',
      boxShadow: '0 -4px 24px rgba(0,0,0,0.5)',
      overflow: 'hidden', zIndex: 200,
    }}>
      <div style={{
        padding: '0.3rem 0.75rem 0.2rem',
        fontSize: '0.68rem', fontWeight: 700, color: '#72767d',
        textTransform: 'uppercase', letterSpacing: '0.07em',
        borderBottom: '1px solid #3b3d43',
      }}>
        Mentions
      </div>

      {suggestions.map((s, i) => (
        <div
          key={`${s.type}-${s.id}`}
          onMouseDown={e => { e.preventDefault(); onSelect(s); }}
          onMouseEnter={() => onHoverIndex(i)}
          style={{
            display: 'flex', alignItems: 'center', gap: '0.55rem',
            padding: '0.4rem 0.75rem',
            background: i === selectedIndex ? '#404249' : 'transparent',
            cursor: 'pointer', transition: 'background 0.08s',
          }}
        >
          <span style={{
            width: 26, height: 26, borderRadius: '50%', flexShrink: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontWeight: 700, fontSize: '0.82rem',
            background: s.type === 'role' && s.color ? `${s.color}33` : 'rgba(255,255,255,0.08)',
            color:      s.type === 'role' && s.color ? s.color : '#b5bac1',
          }}>
            {TYPE_ICON[s.type]}
          </span>
          <span style={{
            fontWeight: 600, fontSize: '0.875rem', flex: 1,
            color: s.type === 'role' && s.color ? s.color : '#f2f3f5',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {s.label}
          </span>
          <span style={{ fontSize: '0.7rem', color: '#4f5660', flexShrink: 0 }}>
            {TYPE_LABEL[s.type]}
          </span>
        </div>
      ))}
    </div>
  );
}