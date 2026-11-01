import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { getMessage, getChannel } from '../../api.js';
import { useApp } from '../../context/AppContext.jsx';
import Avatar from '../Avatar.jsx';
import { parseUtcDate, isWebhookMessage, webhookAvatarSrc } from './utils.js';
import './chat.css';

const cardStyle = {
  display: 'inline-flex', alignItems: 'center', gap: '0.75rem',
  background: 'var(--bg-secondary)', border: '1px solid var(--border)',
  borderRadius: '8px', padding: '0.75rem 1rem',
  marginTop: '0.35rem', maxWidth: 440,
};

/**
 * A compact card shown when a message link appears in a message.
 * Props: channelId (string | number), messageId (string | number)
 */
export default function MessageCard({ channelId, messageId }) {
  const { resolveUser, getMemberColor } = useApp();
  const nav = useNavigate();
  const [state, setState] = useState('loading'); // loading | loaded | error
  const [message, setMessage] = useState(null);
  const [channel, setChannel] = useState(null);
  const [author, setAuthor] = useState(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setState('loading');
      try {
        const [msgData, channelData] = await Promise.all([
          getMessage(channelId, messageId),
          getChannel(channelId).catch(() => null)
        ]);
        
        if (cancelled) return;
        
        setMessage(msgData);
        setChannel(channelData);
        
        // Resolve author
        const authorData = await resolveUser(msgData.authorId);
        if (!cancelled) {
          setAuthor(authorData);
          setState('loaded');
        }
      } catch (err) {
        if (!cancelled) {
          console.error('Failed to load message preview:', err);
          setState('error');
        }
      }
    }

    load();
    return () => { cancelled = true; };
  }, [channelId, messageId]); // eslint-disable-line react-hooks/exhaustive-deps

  function handleClick() {
    nav(`/app/channel/${channelId}?message=${messageId}`);
  }

  if (state === 'loading') {
    return (
      <div style={cardStyle}>
        <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>Loading message…</div>
      </div>
    );
  }

  if (state === 'error' || !message) {
    return (
      <div style={cardStyle}>
        <span style={{ fontSize: '0.82rem', color: 'var(--danger)' }}>
          Message not found or no access
        </span>
      </div>
    );
  }

  // Role colour (for guild channels) > profile colour > generated hue
  const authorName = isWebhookMessage(message) ? message.webhookUsername : author?.username;
  const authorColor = getMemberColor(channel?.guildId ?? null, message.authorId, authorName, author?.color);
  const timestamp = parseUtcDate(message.createdAt).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });

  // Truncate long messages
  const maxLength = 100;
  const content = message.content.length > maxLength
    ? message.content.slice(0, maxLength) + '…'
    : message.content;

  return (
    <div
      onClick={handleClick}
      className="chat-message-card"
      style={{ ...cardStyle, alignItems: 'flex-start', cursor: 'pointer' }}
    >
      {/* Author avatar */}
      <Avatar
        userId={message.authorId}
        src={isWebhookMessage(message) ? webhookAvatarSrc(message) : undefined}
        name={authorName}
        size={32}
        color={author?.color}
        style={{ flexShrink: 0, marginTop: 2 }}
      />

      <div style={{ flex: 1, overflow: 'hidden', minWidth: 0 }}>
        {/* Header: channel name (if available) */}
        {channel && (
          <div style={{
            fontSize: '0.7rem',
            color: 'var(--text-muted)',
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
            fontWeight: 700,
            marginBottom: '0.1rem',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap'
          }}>
            {channel.name ? `# ${channel.name}` : 'Message'}
          </div>
        )}

        {/* Author name and timestamp */}
        <div style={{
          display: 'flex',
          alignItems: 'baseline',
          gap: '0.4rem',
          marginBottom: '0.25rem'
        }}>
          <span style={{
            fontSize: '0.85rem',
            color: authorColor,
            fontWeight: 600,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap'
          }}>
            {authorName ?? message.authorId?.slice(0, 10)}
          </span>
          <span style={{ fontSize: '0.65rem', color: 'var(--text-subtle)', flexShrink: 0 }}>
            {timestamp}
          </span>
        </div>

        {/* Message content preview */}
        <div style={{
          fontSize: '0.82rem',
          color: 'var(--text-secondary)',
          lineHeight: 1.4,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap'
        }}>
          {content}
        </div>
      </div>

      {/* Jump indicator */}
      <div style={{
        flexShrink: 0,
        fontSize: '0.9rem',
        color: 'var(--text-subtle)',
        alignSelf: 'center'
      }}>
        →
      </div>
    </div>
  );
}
