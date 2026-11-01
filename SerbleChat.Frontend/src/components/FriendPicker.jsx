import { useState, useEffect } from 'react';
import { useApp } from '../context/AppContext.jsx';
import Avatar from './Avatar.jsx';
import { FieldLabel, TextInput } from './ui/index.js';
import { CheckIcon } from '../icons.jsx';

/** The id of the other user in a friendship row. */
export function friendIdOf(friendship, myId) {
  return friendship.user1Id === myId ? friendship.user2Id : friendship.user1Id;
}

/**
 * Multi-select list of users (used to pick friends for group chats).
 * Props:
 *  userIds    string[]       users to list
 *  selected   Set<string>    currently selected ids
 *  onToggle   fn(id)
 *  label      string         field label; the selected count is appended
 *  emptyText  string         shown when userIds is empty
 *  loading    bool           show a loading line instead of the list
 *  listStyle  object         extra style for the scrolling list (e.g. maxHeight)
 *
 * A search box appears once there are enough users to need one.
 */
export default function FriendPicker({ userIds, selected, onToggle, label, emptyText, loading, listStyle }) {
  const { resolveUser } = useApp();
  const [userMap, setUserMap] = useState({});
  const idsKey = userIds.join(',');

  useEffect(() => {
    let cancelled = false;
    userIds.forEach(id => {
      resolveUser(id).then(u => { if (!cancelled) setUserMap(p => ({ ...p, [id]: u })); });
    });
    return () => { cancelled = true; };
  }, [idsKey, resolveUser]); // eslint-disable-line react-hooks/exhaustive-deps

  const [query, setQuery] = useState('');
  const selectedCount = userIds.filter(id => selected.has(id)).length;
  const showSearch = userIds.length > 6;
  const q = query.trim().toLowerCase();
  // Selected users stay visible while filtering so they can be un-ticked
  const shown = q ? userIds.filter(id => selected.has(id) || userMap[id]?.username?.toLowerCase().includes(q)) : userIds;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: '1 1 auto', minHeight: 0 }}>
      <FieldLabel>
        {label} {selectedCount > 0 && <span style={{ color: 'var(--accent)' }}>— {selectedCount} selected</span>}
      </FieldLabel>
      <div style={{
        background: 'var(--bg-tertiary)', border: '1px solid var(--border)', borderRadius: '6px',
        flex: '1 1 auto', minHeight: 0, overflowY: 'auto',
        ...listStyle,
      }}>
        {showSearch && !loading && (
          <div style={{ position: 'sticky', top: 0, zIndex: 1, padding: '0.5rem', background: 'var(--bg-tertiary)', borderBottom: '1px solid var(--border)' }}>
            <TextInput
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') e.preventDefault(); }} // don't submit the surrounding form
              placeholder="Search friends"
              aria-label="Search friends"
              style={{ padding: '0.35rem 0.6rem', fontSize: '0.85rem' }}
            />
          </div>
        )}
        {!loading && userIds.length > 0 && shown.length === 0 && (
          <div style={{ padding: '1rem', color: 'var(--text-subtle)', fontSize: '0.85rem', textAlign: 'center' }}>No friends match "{query.trim()}"</div>
        )}
        {(loading || userIds.length === 0) && (
          <div style={{ padding: '1rem', color: 'var(--text-subtle)', fontSize: '0.85rem', textAlign: 'center' }}>
            {loading ? 'Loading…' : emptyText}
          </div>
        )}
        {!loading && shown.map(id => {
          const u = userMap[id];
          const isSelected = selected.has(id);
          return (
            <button
              key={id}
              type="button"
              onClick={() => onToggle(id)}
              aria-pressed={isSelected}
              className={isSelected ? undefined : 'hov-bg-secondary'}
              style={{
                display: 'flex', alignItems: 'center', gap: '0.75rem', width: '100%',
                padding: '0.55rem 0.75rem', cursor: 'pointer', border: 'none',
                font: 'inherit', textAlign: 'left',
                background: isSelected ? 'var(--accent-soft)' : 'transparent',
                transition: 'background 0.1s',
              }}
            >
              <Avatar userId={id} name={u?.username} size={32} color={u?.color} />
              <span style={{
                flex: 1, color: 'var(--text-secondary)', fontSize: '0.875rem', fontWeight: isSelected ? 600 : 400,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {u?.username ?? '…'}
              </span>
              {/* Checkbox */}
              <span style={{
                width: 20, height: 20, borderRadius: '50%', flexShrink: 0,
                border: `2px solid ${isSelected ? 'var(--accent)' : 'var(--text-subtle)'}`,
                background: isSelected ? 'var(--accent)' : 'transparent',
                color: '#fff',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                transition: 'background 0.15s, border-color 0.15s',
              }}>
                {isSelected && <CheckIcon size={11} strokeWidth={3} />}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
