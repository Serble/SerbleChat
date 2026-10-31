import React, { useState, useEffect, useRef, useMemo } from 'react';
import UserInteraction from '../UserInteraction.jsx';
import Avatar from '../Avatar.jsx';
import InviteCard from '../InviteCard.jsx';
import MessageCard from './MessageCard.jsx';
import FileEmbed from './FileEmbed.jsx';
import { MentionText } from './MentionRenderer.jsx';
import { BlockIcon } from '../../icons.jsx';
import { TextArea } from '../ui/index.js';
import { mdComponents } from './markdown.jsx';
import { extractInviteIds, extractMessageLinks, extractFileUrls, parseUtcDate } from './utils.js';

// Consecutive messages from the same author within this window are grouped
const GROUP_WINDOW_MS = 5 * 60 * 1000;
const EDITOR_MAX_HEIGHT = 320;
const PENDING_COLOR = 'var(--warning)';

function autosize(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, EDITOR_MAX_HEIGHT) + 'px';
}

/** Short time for compact rows, e.g. "14:30". */
function formatShortTime(msg) {
  if (msg._pending) return 'Sending…';
  return parseUtcDate(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
}

/** Timestamp next to the username — includes the date when the message isn't from today. */
function formatHeaderTime(msg) {
  if (msg._pending) return 'Sending…';
  const d = parseUtcDate(msg.createdAt);
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (d.toLocaleDateString() === new Date().toLocaleDateString()) return time;
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' + time;
}

/** Inline editor shown in place of the message content while editing. */
function MessageEditor({ initialContent, onSave, onCancel }) {
  const [draft, setDraft] = useState(initialContent);
  const ref = useRef(null);

  // Focus, size to content and put the caret at the end when editing starts
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      const el = ref.current;
      if (!el) return;
      autosize(el);
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    });
    return () => cancelAnimationFrame(id);
  }, []);

  return (
    <div style={{ marginTop: '0.2rem' }}>
      <TextArea
        ref={ref}
        rows={1}
        value={draft}
        onChange={e => { setDraft(e.target.value); autosize(e.target); }}
        onKeyDown={e => {
          if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSave(draft); }
          if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
        }}
        style={{
          boxSizing: 'border-box', display: 'block',
          color: 'var(--text-secondary)', padding: '0.45rem 0.75rem',
          resize: 'none', lineHeight: 1.5, minHeight: '2.2rem',
          maxHeight: '20rem', overflowY: 'auto',
        }}
        maxLength={16384}
      />
      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginTop: '0.3rem', fontSize: '0.73rem', color: 'var(--text-muted)' }}>
        <span>Enter <span style={{ color: 'var(--text-subtle)' }}>to save</span></span>
        <span style={{ color: 'var(--border)' }}>•</span>
        <span>Esc <span style={{ color: 'var(--text-subtle)' }}>to cancel</span></span>
      </div>
    </div>
  );
}

/** Message text plus any invite / message-link / file embeds found in it. */
function MessageContent({ msg, mentionData, resolveUser, onUserClick, onImageContextMenu }) {
  const inviteIds    = useMemo(() => extractInviteIds(msg.content), [msg.content]);
  const messageLinks = useMemo(() => extractMessageLinks(msg.content), [msg.content]);
  const fileUrls     = useMemo(() => extractFileUrls(msg.content), [msg.content]);

  return (
    <>
      <MentionText
        content={msg.content}
        mdComponents={mdComponents}
        mentionData={mentionData}
        resolveUser={resolveUser}
        onUserClick={onUserClick}
        appendNode={msg.editedAt ? (
          <span
            title={`Edited ${parseUtcDate(msg.editedAt).toLocaleString()}`}
            style={{ fontSize: '0.65rem', color: 'var(--text-subtle)', fontStyle: 'italic', marginLeft: '0.25rem' }}
          >
            (edited)
          </span>
        ) : undefined}
      />
      {inviteIds.map(id => (
        <InviteCard key={id} inviteId={id} />
      ))}
      {messageLinks.map(link => (
        <MessageCard key={`${link.channelId}-${link.messageId}`} channelId={link.channelId} messageId={link.messageId} />
      ))}
      {fileUrls.map(url => {
        const filename = url.split('/').pop();
        return (
          <FileEmbed
            key={url}
            fileUrl={url}
            onImageContextMenu={e => onImageContextMenu(e, url, filename, false, msg)}
            onModalImageContextMenu={e => onImageContextMenu(e, url, filename, true)}
          />
        );
      })}
    </>
  );
}

export const MessageBubble = React.memo(function MessageBubble({
  msg, prevMsg, resolveUser, onContextMenu, onImageContextMenu, onUserClick, getColor,
  mentionData, highlighted, guildId, isEditing, onEditSave, onEditCancel,
}) {
  const [author, setAuthor] = useState(null);

  // Group consecutive messages from the same author
  const compact = prevMsg && prevMsg.authorId === msg.authorId &&
    parseUtcDate(msg.createdAt) - parseUtcDate(prevMsg.createdAt) < GROUP_WINDOW_MS;

  useEffect(() => {
    let cancelled = false;
    resolveUser(msg.authorId).then(u => { if (!cancelled) setAuthor(u); });
    return () => { cancelled = true; };
  }, [msg.authorId, resolveUser]);

  // Resolve color: role color > user profile color > generated hue
  const nameColor = getColor(msg.authorId, author?.username, author?.color);
  const timeColor = msg._pending ? PENDING_COLOR : 'var(--text-subtle)';

  const body = isEditing
    ? <MessageEditor initialContent={msg.content} onSave={draft => onEditSave(msg, draft)} onCancel={onEditCancel} />
    : <MessageContent msg={msg} mentionData={mentionData} resolveUser={resolveUser} onUserClick={onUserClick} onImageContextMenu={onImageContextMenu} />;

  return (
    <div
      data-msgid={msg.id}
      className={highlighted ? 'msg-highlighted hov-bg' : 'hov-bg'}
      onContextMenu={e => onContextMenu(e, msg)}
      style={{
        padding: compact ? '0.1rem 1rem' : '0.5rem 1rem',
        display: 'flex', gap: '0.75rem',
        opacity: msg._pending ? 0.55 : 1, cursor: 'default',
      }}
    >
      {compact ? (
        <>
          <span style={{ fontSize: '0.65rem', color: timeColor, width: 40, flexShrink: 0, alignSelf: 'center', textAlign: 'right' }}>
            {formatShortTime(msg)}
          </span>
          <div style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', lineHeight: 1.5, wordBreak: 'break-word', flex: 1, minWidth: 0, overflowX: 'hidden' }}>
            {body}
          </div>
        </>
      ) : (
        <>
          <UserInteraction userId={msg.authorId} username={author?.username} guildId={guildId} disabled={msg._pending}>
            <div style={{ flexShrink: 0 }}>
              <Avatar userId={msg.authorId} name={author?.username} size={40} color={author?.color} style={{ marginTop: 2 }} />
            </div>
          </UserInteraction>
          <div style={{ flex: 1, overflowX: 'hidden', minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem', marginBottom: '0.2rem' }}>
              <UserInteraction userId={msg.authorId} username={author?.username} guildId={guildId} disabled={msg._pending}>
                <span style={{ fontWeight: 600, color: nameColor, fontSize: '0.9rem' }}>
                  {author?.username ?? msg.authorId.slice(0, 10)}
                </span>
              </UserInteraction>
              <span style={{ fontSize: '0.68rem', color: timeColor }}>{formatHeaderTime(msg)}</span>
            </div>
            <div style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', lineHeight: 1.5, wordBreak: 'break-word' }}>
              {body}
            </div>
          </div>
        </>
      )}
    </div>
  );
});

/**
 * A run of consecutive messages from a blocked user, collapsed behind a
 * "N messages from blocked user" bar that can be expanded on click.
 */
export function BlockedGroupBubble({ messages, authorId, resolveUser, onContextMenu, onImageContextMenu, onUserClick, getColor, mentionData, guildId }) {
  const [expanded, setExpanded] = useState(false);
  const [author, setAuthor] = useState(null);

  useEffect(() => {
    let cancelled = false;
    resolveUser(authorId).then(u => { if (!cancelled) setAuthor(u); });
    return () => { cancelled = true; };
  }, [authorId, resolveUser]);

  const count = messages.length;
  const name = author?.username ?? '…';

  if (expanded) {
    return (
      <div>
        {messages.map((msg, i) => (
          <MessageBubble
            key={msg.id}
            msg={msg}
            prevMsg={i === 0 ? null : messages[i - 1]}
            resolveUser={resolveUser}
            onContextMenu={onContextMenu}
            onImageContextMenu={onImageContextMenu}
            onUserClick={onUserClick}
            getColor={getColor}
            mentionData={mentionData}
            highlighted={false}
            guildId={guildId}
          />
        ))}
        <div
          onClick={() => setExpanded(false)}
          className="hov-text-secondary"
          style={{
            padding: '0.25rem 1rem 0.35rem',
            fontSize: '0.78rem', color: 'var(--text-muted)',
            cursor: 'pointer', userSelect: 'none',
            display: 'flex', alignItems: 'center', gap: '0.4rem',
          }}
        >
          <span>▲</span>
          <span>Hide messages from blocked user</span>
        </div>
      </div>
    );
  }

  return (
    <div
      onClick={() => setExpanded(true)}
      className="hov-bg"
      style={{
        margin: '0.25rem 1rem', padding: '0.45rem 0.8rem',
        borderRadius: '6px', background: 'var(--bg-secondary)', border: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', gap: '0.6rem',
        cursor: 'pointer', userSelect: 'none', transition: 'background 0.1s',
      }}
    >
      <BlockIcon size={15} style={{ flexShrink: 0 }} />
      <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)', flex: 1 }}>
        {count === 1
          ? `1 message from blocked user ${name}`
          : `${count} messages from blocked user ${name}`}
      </span>
      <span style={{ fontSize: '0.75rem', color: 'var(--text-subtle)', flexShrink: 0 }}>click to show ▼</span>
    </div>
  );
}
