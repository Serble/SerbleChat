import React, { useState, useEffect } from 'react';
import './chat.css';

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

    // Resolve usernames for each typing user; ignore results for a stale set
    let cancelled = false;
    Promise.all(Array.from(users).map(userId => resolveUser(userId)))
      .then(resolved => { if (!cancelled) setUserDetails(resolved); })
      .catch(e => console.error('Failed to resolve typing users:', e));
    return () => { cancelled = true; };
  }, [users, resolveUser]);

  if (!users || users.size === 0) return null;

  const names = userDetails
    .map(u => u?.username || 'User')
    .slice(0, 3)
    .join(', ');

  const suffix = users.size > 3 ? ` +${users.size - 3}` : '';
  const isPlural = users.size > 1;

  return (
    <div className="typing-indicator" aria-live="polite">
      <span className="typing-dots" aria-hidden="true"><span /><span /><span /></span>
      <span className="typing-text">
        <strong>{names}{suffix}</strong> {isPlural ? 'are' : 'is'} typing…
      </span>
    </div>
  );
}

export default React.memo(TypingIndicator);
