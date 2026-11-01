import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import { useClientOptions } from '../../context/ClientOptionsContext.jsx';
import './chat.css';

/** Matches <@user:id>, <@channel:id>, <@role:id> */
export const MENTION_RE = /<@(user|channel|role):([^>\s]+)>/g;

// Faint background for role chips / picker icons without a colour of their own
const NEUTRAL_TINT = 'color-mix(in srgb, var(--text-primary) 8%, transparent)';

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

// ─── MentionChip ──────────────────────────────────────────────────────────────

export function MentionChip({ type, id, mentionData, resolveUser, onUserClick }) {
  const nav = useNavigate();
  const [label, setLabel] = useState(null);
  const [color, setColor] = useState(null);

  useEffect(() => {
    let cancelled = false;
    if (type === 'user') {
      const found = mentionData?.members?.find(m => String(m.id) === String(id));
      if (found) { setLabel(found.username); return; }
      resolveUser?.(id).then(u => { if (!cancelled) setLabel(u?.username ?? id.slice(0, 8)); });
    } else if (type === 'channel') {
      const found = mentionData?.channels?.find(c => String(c.id) === String(id));
      setLabel(found?.name ?? `channel-${id}`);
    } else if (type === 'role') {
      const found = mentionData?.roles?.find(r => String(r.id) === String(id));
      setLabel(found?.name ?? `role-${id}`);
      setColor(found?.color || null);
    }
    return () => { cancelled = true; };
  }, [type, id, mentionData]); // eslint-disable-line react-hooks/exhaustive-deps

  const txt = label ?? '…';

  if (type === 'user') return (
    <span
      className="chat-mention chat-mention--link"
      onClick={e => { e.stopPropagation(); onUserClick?.(e, id, label); }}
    >@{txt}</span>
  );

  if (type === 'channel') return (
    <span className="chat-mention chat-mention--link" onClick={() => nav(`/app/channel/${id}`)}>#{txt}</span>
  );

  if (type === 'role') return (
    <span
      className="chat-mention"
      style={{ background: color ? `${color}33` : NEUTRAL_TINT, color: color || 'var(--text-secondary)' }}
    >@{txt}</span>
  );

  return null;
}

// ─── MentionText ─────────────────────────────────────────────────────────────

/**
 * remark plugin: split <@type:id> tokens out of text nodes into `mention`
 * elements, so mentions render inline in the same markdown pass as the
 * surrounding text. Code spans/blocks aren't text nodes, so tokens in code stay literal.
 */
function remarkMentions() {
  return (tree) => splitMentions(tree);
}

function splitMentions(node) {
  if (!node.children) return;
  const out = [];
  for (const child of node.children) {
    if (child.type !== 'text' || !child.value.includes('<@')) {
      splitMentions(child);
      out.push(child);
      continue;
    }
    const re = new RegExp(MENTION_RE.source, 'g');
    let last = 0, m;
    while ((m = re.exec(child.value)) !== null) {
      if (m.index > last) out.push({ type: 'text', value: child.value.slice(last, m.index) });
      out.push({
        type: 'mention', children: [],
        data: { hName: 'mention', hProperties: { mentionType: m[1], mentionId: m[2] } },
      });
      last = m.index + m[0].length;
    }
    if (last < child.value.length) out.push({ type: 'text', value: child.value.slice(last) });
  }
  node.children = out;
}

/** remark plugin: put an `edited` marker at the end of the last paragraph (or on its own line). */
function remarkEditedMarker({ title }) {
  return (tree) => {
    const marker = { type: 'edited', children: [], data: { hName: 'edited', hProperties: { title } } };
    const last = tree.children[tree.children.length - 1];
    if (last?.type === 'paragraph') last.children.push({ type: 'text', value: ' ' }, marker);
    else tree.children.push({ type: 'paragraph', children: [marker] });
  };
}

const MENTION_PLUGINS = [remarkGfm, remarkBreaks, remarkMentions];

/**
 * Renders a message string as markdown, with <@type:id> tokens shown as inline
 * MentionChips and an optional "(edited)" marker after the last line.
 *
 * Long messages (more lines than the messageLinesLimit option) are shown collapsed
 * with a "Show more" button — the full markdown is always rendered, only
 * clipped via CSS so nothing is ever truncated or lost.
 *
 * Wrapped in React.memo so it only re-renders when its own props change.
 */
export const MentionText = React.memo(function MentionText({ content, mdComponents, mentionData, resolveUser, onUserClick, editedTitle }) {
  const [expanded, setExpanded] = useState(false);
  const { messageLinesLimit } = useClientOptions() ?? { messageLinesLimit: 28 };
  const collapsedMaxHeight = `${messageLinesLimit * 1.375}rem`;

  const plugins = useMemo(
    () => editedTitle ? [...MENTION_PLUGINS, [remarkEditedMarker, { title: editedTitle }]] : MENTION_PLUGINS,
    [editedTitle]
  );

  const components = useMemo(() => ({
    ...mdComponents,
    mention: ({ node }) => (
      <MentionChip
        type={node.properties.mentionType}
        id={String(node.properties.mentionId)}
        mentionData={mentionData}
        resolveUser={resolveUser}
        onUserClick={onUserClick}
      />
    ),
    edited: ({ node }) => <span className="msg-edited" title={node.properties.title}>(edited)</span>,
  }), [mdComponents, mentionData, resolveUser, onUserClick]);

  if (!content) return null;

  const body = (
    <MarkdownErrorBoundary key={content} fallback={content}>
      <ReactMarkdown remarkPlugins={plugins} components={components}>
        {preserveBlankLines(content)}
      </ReactMarkdown>
    </MarkdownErrorBoundary>
  );

  const isLong = (content.match(/\n/g)?.length ?? 0) >= messageLinesLimit;
  if (!isLong) return <div className="msg-md">{body}</div>;

  return (
    <div>
      <div
        className={expanded ? 'msg-md' : 'msg-md msg-md--collapsed'}
        style={expanded ? undefined : { maxHeight: collapsedMaxHeight }}
      >
        {body}
      </div>
      <button type="button" className="msg-show-more" onClick={() => setExpanded(v => !v)}>
        {expanded ? 'Show less' : 'Show more'}
      </button>
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
    <div className="chat-mention-picker">
      <div style={{
        padding: '0.3rem 0.75rem 0.2rem',
        fontSize: '0.68rem', fontWeight: 700, color: 'var(--text-muted)',
        textTransform: 'uppercase', letterSpacing: '0.07em',
        borderBottom: '1px solid var(--border)',
      }}>
        Mentions
      </div>

      {suggestions.map((s, i) => {
        const roleColor = s.type === 'role' && s.color ? s.color : null;
        return (
          <div
            key={`${s.type}-${s.id}`}
            className="chat-mention-option"
            data-selected={i === selectedIndex}
            onMouseDown={e => { e.preventDefault(); onSelect(s); }}
            onMouseEnter={() => onHoverIndex(i)}
          >
            <span style={{
              width: 26, height: 26, borderRadius: '50%', flexShrink: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontWeight: 700, fontSize: '0.82rem',
              background: roleColor ? `${roleColor}33` : NEUTRAL_TINT,
              color:      roleColor ?? 'var(--text-secondary)',
            }}>
              {TYPE_ICON[s.type]}
            </span>
            <span style={{
              fontWeight: 600, fontSize: '0.875rem', flex: 1,
              color: roleColor ?? 'var(--text-primary)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {s.label}
            </span>
            <span style={{ fontSize: '0.7rem', color: 'var(--text-subtle)', flexShrink: 0 }}>
              {TYPE_LABEL[s.type]}
            </span>
          </div>
        );
      })}
    </div>
  );
}
