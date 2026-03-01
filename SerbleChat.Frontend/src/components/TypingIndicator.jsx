import React, { useState, useEffect } from 'react';

/**
 * Animated typing indicator component.
 * Displays avatars/names of users currently typing with a pulsing ellipsis.
 */
function TypingIndicator({ users, resolveUser }) {
  const [userDetails, setUserDetails] = useState([]);

  useEffect(() => {
    if (!users || users.size === 0) {
      setUserDetails([]);
      return;
    }

    // Resolve usernames for each typing user
    Promise.all(Array.from(users).map(userId => resolveUser(userId)))
      .then(resolved => setUserDetails(resolved))
      .catch(e => console.error('Failed to resolve typing users:', e));
  }, [users, resolveUser]);

  if (!users || users.size === 0) return null;

  const names = userDetails
    .map(u => u?.username || 'User')
    .slice(0, 3)
    .join(', ');

  const suffix = users.size > 3 ? ` +${users.size - 3}` : '';
  const isPlural = users.size > 1;

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.5rem',
        padding: '0.5rem 1rem',
        fontSize: '0.85rem',
        color: 'var(--text-muted)',
        minHeight: '2rem',
        userSelect: 'none',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
        <span style={{ fontSize: '0.7rem', opacity: 0.7 }}>●</span>
        <span style={{ fontSize: '0.7rem', opacity: 0.5 }}>●</span>
        <span style={{ fontSize: '0.7rem', opacity: 0.3 }}>●</span>
      </div>
      <span>
        <strong style={{ color: 'var(--text-secondary)' }}>
          {names}{suffix}
        </strong>{' '}
        {isPlural ? 'are' : 'is'} typing
      </span>
    </div>
  );
}

export default React.memo(TypingIndicator);
