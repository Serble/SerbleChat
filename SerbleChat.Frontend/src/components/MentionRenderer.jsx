import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

/** Matches <@user:id>, <@channel:id>, <@role:id> */
export const MENTION_RE = /<@(user|channel|role):([^>\s]+)>/g;

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
 * passing remaining text through ReactMarkdown.
 */
export function MentionText({ content, mdComponents, mentionData, resolveUser, onUserClick }) {
  if (!content) return null;

  const re = new RegExp(MENTION_RE.source, 'g');
  const parts = [];
  let last = 0, m;

  while ((m = re.exec(content)) !== null) {
    if (m.index > last) parts.push({ kind: 'text', value: content.slice(last, m.index) });
    parts.push({ kind: 'mention', type: m[1], id: m[2] });
    last = m.index + m[0].length;
  }
  if (last < content.length) parts.push({ kind: 'text', value: content.slice(last) });

  // Fast path: no mentions at all
  if (parts.length === 0) return null;
  if (parts.length === 1 && parts[0].kind === 'text') {
    return <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>{content}</ReactMarkdown>;
  }

  return (
    <>
      {parts.map((p, i) =>
        p.kind === 'text'
          ? <ReactMarkdown key={i} remarkPlugins={[remarkGfm]} components={mdComponents}>{p.value}</ReactMarkdown>
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
}

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
          {/* Icon circle */}
          <span style={{
            width: 26, height: 26, borderRadius: '50%', flexShrink: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontWeight: 700, fontSize: '0.82rem',
            background: s.type === 'role' && s.color ? `${s.color}33` : 'rgba(255,255,255,0.08)',
            color:      s.type === 'role' && s.color ? s.color : '#b5bac1',
          }}>
            {TYPE_ICON[s.type]}
          </span>

          {/* Label */}
          <span style={{
            fontWeight: 600, fontSize: '0.875rem', flex: 1,
            color: s.type === 'role' && s.color ? s.color : '#f2f3f5',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {s.label}
          </span>

          {/* Type badge */}
          <span style={{ fontSize: '0.7rem', color: '#4f5660', flexShrink: 0 }}>
            {TYPE_LABEL[s.type]}
          </span>
        </div>
      ))}
    </div>
  );
}
