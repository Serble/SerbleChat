import React, { useState, useEffect, useRef, useMemo } from 'react';
import UserInteraction from '../UserInteraction.jsx';
import Avatar from '../Avatar.jsx';
import InviteCard from '../InviteCard.jsx';
import MessageCard from './MessageCard.jsx';
import FileEmbed from './FileEmbed.jsx';
import PollCard from '../poll/PollCard.jsx';
import { MentionText } from './MentionRenderer.jsx';
import { BlockIcon, EditIcon, TrashIcon, MoreIcon } from '../../icons.jsx';
import { TextArea } from '../ui/index.js';
import { mdComponents } from './markdown.jsx';
import { extractInviteIds, extractMessageLinks, extractFileUrls, parseUtcDate, isWebhookMessage, webhookAvatarSrc } from './utils.js';
import { useDateFormat, formatTime, formatDate, formatDateLong } from '../../dateFormat.js';
import './chat.css';

const EDITOR_MAX_HEIGHT = 320;

function autosize(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, EDITOR_MAX_HEIGHT) + 'px';
}

/** Full date + time for timestamp tooltips. */
function formatFullDate(date) {
  return `${formatDateLong(date)}, ${formatTime(date)}`;
}

/** Header timestamp: the time today, "Yesterday at …", or the date and time before that. */
function formatHeaderTime(date) {
  const now = new Date();
  const startOf = d => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOf(now) - startOf(date)) / (24 * 3600 * 1000));
  if (days === 0) return formatTime(date);
  if (days === 1) return `Yesterday at ${formatTime(date)}`;
  return `${formatDate(date)} ${formatTime(date)}`;
}

/** Author of a message, from the user cache on first paint when possible. Null for webhook messages. */
function useAuthor(authorId, peekUser, resolveUser) {
  const [author, setAuthor] = useState(() => (authorId ? peekUser?.(authorId) : null) ?? null);
  useEffect(() => {
    if (!authorId) { setAuthor(null); return; }
    let cancelled = false;
    resolveUser(authorId).then(u => { if (!cancelled) setAuthor(u); });
    return () => { cancelled = true; };
  }, [authorId, resolveUser]);
  return author;
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
      el.focus({ preventScroll: true });
      el.setSelectionRange(el.value.length, el.value.length);
      // Editing can start from the composer (up arrow) on a message that's scrolled out of view
      el.closest('[data-msgid]')?.scrollIntoView({ block: 'nearest' });
    });
    return () => cancelAnimationFrame(id);
  }, []);

  return (
    <div className="msg-editor">
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
          color: 'var(--text-secondary)', padding: '0.5rem 0.75rem',
          resize: 'none', lineHeight: 1.375, minHeight: '2.25rem',
          maxHeight: EDITOR_MAX_HEIGHT, overflowY: 'auto',
        }}
        maxLength={16384}
      />
      <div className="msg-editor-hint">
        escape to <button type="button" onClick={onCancel}>cancel</button>
        {' • '}
        enter to <button type="button" onClick={() => onSave(draft)}>save</button>
      </div>
    </div>
  );
}

/** Message text plus any invite / message-link / file embeds found in it. */
function MessageContent({ msg, mentionData, resolveUser, onUserClick, onImageContextMenu }) {
  useDateFormat();  // re-render the "Edited" tooltip when the format settings change
  const inviteIds    = useMemo(() => extractInviteIds(msg.content), [msg.content]);
  const messageLinks = useMemo(() => extractMessageLinks(msg.content), [msg.content]);
  const fileUrls     = useMemo(() => extractFileUrls(msg.content), [msg.content]);
  const editedTitle  = msg.editedAt ? `Edited ${formatFullDate(parseUtcDate(msg.editedAt))}` : null;
  const hasEmbeds    = inviteIds.length + messageLinks.length + fileUrls.length > 0;

  return (
    <>
      <MentionText
        content={msg.content}
        mdComponents={mdComponents}
        mentionData={mentionData}
        resolveUser={resolveUser}
        onUserClick={onUserClick}
        editedTitle={editedTitle}
      />
      {hasEmbeds && (
        <div className="msg-embeds">
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
        </div>
      )}
    </>
  );
}

/** Floating quick-action bar shown when hovering a message. */
function MessageActions({ msg, canEdit, canDelete, onStartEdit, onDelete, onMore }) {
  return (
    <div className="msg-actions" onContextMenu={e => e.stopPropagation()}>
      {canEdit && (
        <button type="button" className="msg-action" title="Edit" onClick={() => onStartEdit(msg)}>
          <EditIcon size={16} />
        </button>
      )}
      {canDelete && (
        <button type="button" className="msg-action msg-action--danger" title="Delete" onClick={() => onDelete(msg)}>
          <TrashIcon size={16} />
        </button>
      )}
      <button type="button" className="msg-action" title="More" onClick={e => onMore(e, msg)}>
        <MoreIcon size={16} />
      </button>
    </div>
  );
}

/**
 * A single message row. `grouped` rows continue the previous author's group:
 * no avatar or name, with the time shown in the gutter on hover.
 */
export const MessageBubble = React.memo(function MessageBubble({
  msg, grouped, peekUser, resolveUser, onContextMenu, onImageContextMenu, onUserClick, getColor,
  mentionData, highlighted, active, guildId, isEditing, onEditSave, onEditCancel,
  currentUserId, canManageMsgs, onStartEdit, onDelete, onMore,
}) {
  const author = useAuthor(msg.authorId, peekUser, resolveUser);
  useDateFormat();  // memoised, so subscribe to format changes explicitly
  const pending = !!msg._pending;
  const webhook = isWebhookMessage(msg);
  const authorName = webhook ? msg.webhookUsername : author?.username;
  const date = parseUtcDate(msg.createdAt);
  const isOwn = msg.authorId === currentUserId;
  const mentionsMe = !!currentUserId && !isOwn && !!msg.content?.includes(`<@user:${currentUserId}>`);

  const classes = ['msg'];
  if (!grouped) classes.push('msg--head');
  if (pending) classes.push('msg--pending');
  if (mentionsMe) classes.push('msg--mention');
  if (highlighted) classes.push('msg--highlight');
  if (isEditing) classes.push('msg--editing');
  if (active) classes.push('msg--active');

  const body = msg.poll
    ? <PollCard poll={msg.poll} canManageMsgs={canManageMsgs} isGuildChannel={guildId != null} />
    : isEditing
    ? <MessageEditor initialContent={msg.content} onSave={draft => onEditSave(msg, draft)} onCancel={onEditCancel} />
    : <MessageContent msg={msg} mentionData={mentionData} resolveUser={resolveUser} onUserClick={onUserClick} onImageContextMenu={onImageContextMenu} />;

  return (
    <div
      data-msgid={msg.id}
      className={classes.join(' ')}
      onContextMenu={e => onContextMenu(e, msg)}
    >
      {grouped ? (
        <div className="msg-gutter">
          <time className="msg-gutter-time" title={formatFullDate(date)}>{pending ? '' : formatTime(date)}</time>
        </div>
      ) : (
        <div className="msg-gutter">
          {webhook ? (
            <div className="msg-avatar msg-avatar--static">
              <Avatar key={webhookAvatarSrc(msg)} src={webhookAvatarSrc(msg)} name={authorName} size={40} />
            </div>
          ) : (
            <UserInteraction userId={msg.authorId} username={author?.username} guildId={guildId} disabled={pending}>
              <div className="msg-avatar">
                <Avatar userId={msg.authorId} name={author?.username} size={40} color={author?.color} />
              </div>
            </UserInteraction>
          )}
        </div>
      )}

      <div className="msg-main">
        {!grouped && (
          <div className="msg-header">
            {webhook ? (
              <>
                <span className="msg-author msg-author--static" style={{ color: getColor(null, authorName) }}>{authorName}</span>
                <span className="msg-bot-tag" title="Posted by a webhook">Webhook</span>
              </>
            ) : (
              <UserInteraction userId={msg.authorId} username={author?.username} guildId={guildId} disabled={pending}>
                <span className="msg-author" style={{ color: getColor(msg.authorId, author?.username, author?.color) }}>
                  {author?.username ?? <span className="msg-author-placeholder" />}
                </span>
              </UserInteraction>
            )}
            <time className="msg-time" title={pending ? undefined : formatFullDate(date)}>
              {pending ? 'Sending…' : formatHeaderTime(date)}
            </time>
          </div>
        )}
        <div className="msg-body">{body}</div>
      </div>

      {!pending && !isEditing && (
        <MessageActions
          msg={msg}
          canEdit={isOwn && !msg.poll}
          canDelete={isOwn || canManageMsgs}
          onStartEdit={onStartEdit}
          onDelete={onDelete}
          onMore={onMore}
        />
      )}
    </div>
  );
});

/**
 * A run of consecutive messages from a blocked user, collapsed behind a
 * "N messages from blocked user" bar that can be expanded on click.
 */
export function BlockedGroupBubble({ messages, authorId, peekUser, resolveUser, ...bubbleProps }) {
  const [expanded, setExpanded] = useState(false);
  const author = useAuthor(authorId, peekUser, resolveUser);

  const count = messages.length;
  const name = author?.username ?? '…';

  return (
    <div className="msg-blocked-group">
      <div className="msg-blocked">
        <BlockIcon size={14} style={{ flexShrink: 0 }} />
        <span className="msg-blocked-label">
          {count === 1 ? '1 message' : `${count} messages`} from blocked user <strong>{name}</strong>
        </span>
        <button type="button" className="msg-blocked-toggle" onClick={() => setExpanded(v => !v)}>
          {expanded ? 'Hide' : 'Show'}
        </button>
      </div>
      {expanded && messages.map((msg, i) => (
        <MessageBubble
          key={msg.id}
          {...bubbleProps}
          msg={msg}
          grouped={i > 0}
          peekUser={peekUser}
          resolveUser={resolveUser}
          highlighted={false}
          isEditing={false}
        />
      ))}
    </div>
  );
}
