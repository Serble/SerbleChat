import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../context/AppContext.jsx';
import { addFriend, removeFriend, getAccountByUsername, getOrCreateDmChannel } from '../api.js';
import UserInteraction from './UserInteraction.jsx';
import { useMobile } from '../context/MobileContext.jsx';
import Avatar from './Avatar.jsx';

const TABS = ['All', 'Pending', 'Blocked', 'Add Friend'];

function Pill({ label, color = '#5865f2' }) {
  return (
    <span style={{
      padding: '0.2rem 0.65rem', borderRadius: '9999px',
      background: `${color}22`, color, fontSize: '0.75rem', fontWeight: 600,
      border: `1px solid ${color}44`,
    }}>
      {label}
    </span>
  );
}

function ActionBtn({ label, color, onClick, disabled }) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        padding: '0.35rem 0.9rem', borderRadius: '6px',
        background: hovered && !disabled ? color : `${color}22`,
        color: hovered && !disabled ? '#fff' : color,
        border: `1px solid ${color}55`,
        fontSize: '0.8rem', fontWeight: 600, cursor: disabled ? 'default' : 'pointer',
        transition: 'background 0.15s, color 0.15s',
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {label}
    </button>
  );
}

function FriendRow({ friendship, currentUserId, onRefresh }) {
  const { resolveUser } = useApp();
  const nav = useNavigate();
  const [user, setUser] = useState(null);
  const [busy, setBusy] = useState(false);

  const otherId = friendship.user1Id === currentUserId ? friendship.user2Id : friendship.user1Id;
  const isIncoming = friendship.pending && friendship.user2Id === currentUserId;
  const isOutgoing = friendship.pending && friendship.user1Id === currentUserId;

  useEffect(() => {
    resolveUser(otherId).then(setUser);
  }, [otherId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleMessage() {
    setBusy(true);
    try {
      const ch = await getOrCreateDmChannel(otherId);
      nav(`/app/channel/${ch.id}`);
    } catch (e) {
      console.error(e);
      setBusy(false);
    }
  }

  async function handleAccept() {
    setBusy(true);
    try {
      await addFriend(friendship.user1Id);
      onRefresh();
    } catch (e) {
      console.error(e);
    } finally { setBusy(false); }
  }

  async function handleRemove() {
    setBusy(true);
    try {
      await removeFriend(otherId);
      onRefresh();
    } catch (e) {
      console.error(e);
    } finally { setBusy(false); }
  }

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: '0.875rem',
      padding: '0.65rem 1rem', borderRadius: '8px',
      borderBottom: '1px solid var(--border)',
      transition: 'background 0.1s',
    }}
      onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-hover)'}
      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
    >
      <UserInteraction userId={otherId} username={user?.username}>
        <div style={{ flexShrink: 0 }}>
          <Avatar userId={otherId} name={user?.username} color={user?.color} />
        </div>
      </UserInteraction>
      <div style={{ flex: 1, overflow: 'hidden' }}>
        <UserInteraction userId={otherId} username={user?.username}>
          <div style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '0.9rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'inline-block', maxWidth: '100%' }}>
            {user?.username ?? '…'}
          </div>
        </UserInteraction>
        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.1rem' }}>
          {isIncoming ? 'Incoming friend request' :
           isOutgoing ? 'Friend request sent' :
           'Friend'}
        </div>
      </div>
      <div style={{ display: 'flex', gap: '0.5rem', flexShrink: 0 }}>
        {!friendship.pending && (
          <>
            <ActionBtn label="Message" color="#23a55a" onClick={handleMessage} disabled={busy} />
            <ActionBtn label="Remove"  color="#ed4245" onClick={handleRemove}  disabled={busy} />
          </>
        )}
        {isIncoming && (
          <>
            <ActionBtn label="Accept" color="#23a55a" onClick={handleAccept} disabled={busy} />
            <ActionBtn label="Ignore" color="#ed4245" onClick={handleRemove} disabled={busy} />
          </>
        )}
        {isOutgoing && (
          <>
            <Pill label="Pending" color="#f0b232" />
            <ActionBtn label="Cancel" color="#ed4245" onClick={handleRemove} disabled={busy} />
          </>
        )}
      </div>
    </div>
  );
}

function EmptyState({ icon, title, text }) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', padding: '4rem 2rem', textAlign: 'center',
    }}>
      <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>{icon}</div>
      <div style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: '0.4rem' }}>{title}</div>
      <div style={{ fontSize: '0.875rem', color: 'var(--text-muted)' }}>{text}</div>
    </div>
  );
}

function BlockedRow({ user, onUnblock }) {
  const [busy, setBusy] = useState(false);

  async function handleUnblock() {
    setBusy(true);
    try { await onUnblock(user.id); }
    catch (e) { console.error(e); }
    finally { setBusy(false); }
  }

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: '0.875rem',
      padding: '0.65rem 1rem', borderRadius: '8px',
      borderBottom: '1px solid var(--border)',
      transition: 'background 0.1s',
    }}
      onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-hover)'}
      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
    >
      <Avatar userId={block.blockedUserId} name={user?.username} color={user?.color} />
      <div style={{ flex: 1, overflow: 'hidden' }}>
        <div style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '0.9rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {user?.username ?? '…'}
        </div>
        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.1rem' }}>Blocked</div>
      </div>
      <ActionBtn label="Unblock" color="#ed4245" onClick={handleUnblock} disabled={busy} />
    </div>
  );
}

export default function FriendsHome() {
  const { friends, currentUser, refreshFriends, blockedUsers, unblockUser, refreshBlockedUsers } = useApp();
  const { isMobile, openSidebar } = useMobile() ?? { isMobile: false, openSidebar: () => {} };
  const [tab, setTab]           = useState('All');
  const [addInput, setAddInput] = useState('');
  const [addStatus, setAddStatus] = useState(null);
  const [addBusy, setAddBusy]   = useState(false);

  if (!currentUser) return null;

  const myId = currentUser.id;

  const accepted = friends.filter(f => !f.pending);
  const incoming = friends.filter(f => f.pending && f.user2Id === myId);
  const outgoing = friends.filter(f => f.pending && f.user1Id === myId);

  async function handleAddFriend(e) {
    e.preventDefault();
    const username = addInput.trim();
    if (!username) return;
    setAddBusy(true);
    setAddStatus(null);
    try {
      const user = await getAccountByUsername(username);
      await addFriend(user.id);
      setAddStatus({ ok: true, msg: `Friend request sent to ${user.username}!` });
      setAddInput('');
      refreshFriends();
    } catch (err) {
      setAddStatus({ ok: false, msg: err.message });
    } finally {
      setAddBusy(false);
    }
  }

  const pendingCount = incoming.length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header */}
      <div style={{
        height: 48, display: 'flex', alignItems: 'center',
        padding: '0 1.25rem 0 1.25rem', gap: '0.25rem',
        borderBottom: '1px solid var(--border)', flexShrink: 0,
        background: 'var(--bg-base)',
      }}>
        {isMobile && (
          <button
            title="Open sidebar"
            onClick={openSidebar}
            style={{
              background: 'none', border: 'none', color: 'var(--text-secondary)',
              cursor: 'pointer', fontSize: '1.2rem', lineHeight: 1,
              padding: '0.25rem', marginRight: '0.25rem', flexShrink: 0,
            }}
          >☰</button>
        )}
        <span style={{ fontWeight: 700, color: 'var(--text-primary)', marginRight: '0.75rem', fontSize: '0.95rem' }}>
          👥 Friends
        </span>
        <div style={{ width: 1, height: 20, background: 'var(--border)', marginRight: '0.5rem', flexShrink: 0 }} />
        <div style={{ display: 'flex', gap: '0.25rem', overflowX: 'auto', flex: 1, scrollbarWidth: 'none' }}>
        {TABS.map(t => {
          const isActive = tab === t;
          const count = t === 'Pending' ? pendingCount : 0;
          return (
            <button
              key={t}
              onClick={() => setTab(t)}
              style={{
                padding: '0.25rem 0.75rem', borderRadius: '4px', border: 'none',
                background: isActive ? 'var(--bg-active)' : 'transparent',
                color: isActive ? 'var(--text-primary)' : 'var(--text-muted)',
                fontWeight: isActive ? 600 : 400, fontSize: '0.875rem',
                cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.4rem',
                transition: 'background 0.1s, color 0.1s',
              }}
              onMouseEnter={e => { if (!isActive) { e.currentTarget.style.background = 'var(--bg-hover)'; e.currentTarget.style.color = 'var(--text-secondary)'; } }}
              onMouseLeave={e => { if (!isActive) { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-muted)'; } }}
            >
              {t}
              {count > 0 && (
                <span style={{
                  background: 'var(--danger)', color: '#fff', borderRadius: '9999px',
                  padding: '0.05rem 0.4rem', fontSize: '0.65rem', fontWeight: 700,
                }}>
                  {count}
                </span>
              )}
            </button>
          );
        })}
        </div>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {/* ── All Friends ── */}
        {tab === 'All' && (
          <div style={{ padding: '1rem 1.25rem 0' }}>
            <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: '0.25rem' }}>
              All Friends — {accepted.length}
            </div>
            {accepted.length === 0 ? (
              <EmptyState icon="🤝" title="No friends yet" text="Add friends to start chatting." />
            ) : (
              accepted.map(f => (
                <FriendRow key={f.id} friendship={f} currentUserId={myId} onRefresh={refreshFriends} />
              ))
            )}
          </div>
        )}

        {/* ── Pending ── */}
        {tab === 'Pending' && (
          <div style={{ padding: '1rem 1.25rem 0' }}>
            {incoming.length === 0 && outgoing.length === 0 ? (
              <EmptyState icon="📭" title="No pending requests" text="You're all caught up!" />
            ) : (
              <>
                {incoming.length > 0 && (
                  <>
                    <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: '0.25rem' }}>
                      Incoming — {incoming.length}
                    </div>
                    {incoming.map(f => (
                      <FriendRow key={f.id} friendship={f} currentUserId={myId} onRefresh={refreshFriends} />
                    ))}
                  </>
                )}
                {outgoing.length > 0 && (
                  <>
                    <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', margin: '1rem 0 0.25rem' }}>
                      Outgoing — {outgoing.length}
                    </div>
                    {outgoing.map(f => (
                      <FriendRow key={f.id} friendship={f} currentUserId={myId} onRefresh={refreshFriends} />
                    ))}
                  </>
                )}
              </>
            )}
          </div>
        )}

        {/* ── Blocked ── */}
        {tab === 'Blocked' && (
          <div style={{ padding: '1rem 1.25rem 0' }}>
            <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: '0.25rem' }}>
              Blocked — {blockedUsers.length}
            </div>
            {blockedUsers.length === 0 ? (
              <EmptyState icon="🚫" title="No blocked users" text="Users you block will appear here." />
            ) : (
              blockedUsers.map(u => (
                <BlockedRow
                  key={u.id}
                  user={u}
                  onUnblock={async (id) => { await unblockUser(id); refreshBlockedUsers(); }}
                />
              ))
            )}
          </div>
        )}

        {/* ── Add Friend ── */}
        {tab === 'Add Friend' && (
          <div style={{ padding: '1.5rem 1.25rem' }}>
            <div style={{ fontWeight: 700, color: 'var(--text-primary)', marginBottom: '0.4rem', fontSize: '0.95rem' }}>
              Add Friend
            </div>
            <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '1rem' }}>
              You can add a friend by their SerbleChat username.
            </div>
            <form onSubmit={handleAddFriend} style={{ display: 'flex', gap: '0.5rem' }}>
              <input
                style={{
                  flex: 1, background: 'var(--bg-tertiary)', border: '1px solid var(--border)',
                  borderRadius: '8px', padding: '0.7rem 1rem', color: 'var(--text-primary)',
                  fontSize: '0.9rem', outline: 'none',
                  transition: 'border-color 0.15s',
                }}
                placeholder="Enter a username…"
                value={addInput}
                onChange={e => setAddInput(e.target.value)}
                disabled={addBusy}
                onFocus={e => e.target.style.borderColor = 'var(--accent)'}
                onBlur={e => e.target.style.borderColor = 'var(--border)'}
              />
              <button
                type="submit"
                disabled={!addInput.trim() || addBusy}
                style={{
                  padding: '0.7rem 1.5rem', borderRadius: '8px',
                  background: addInput.trim() && !addBusy ? 'var(--accent)' : 'var(--bg-active)',
                  color: '#fff', border: 'none', fontWeight: 700,
                  fontSize: '0.875rem', cursor: addInput.trim() && !addBusy ? 'pointer' : 'default',
                  transition: 'background 0.15s', whiteSpace: 'nowrap',
                }}
              >
                {addBusy ? 'Sending…' : 'Send Request'}
              </button>
            </form>
            {addStatus && (
              <div style={{
                marginTop: '0.75rem', padding: '0.65rem 1rem', borderRadius: '6px',
                background: addStatus.ok ? 'rgba(35,165,90,0.15)' : 'rgba(237,66,69,0.15)',
                color: addStatus.ok ? 'var(--success)' : 'var(--danger)',
                fontSize: '0.85rem', border: `1px solid ${addStatus.ok ? 'rgba(35,165,90,0.3)' : 'rgba(237,66,69,0.3)'}`,
              }}>
                {addStatus.ok ? '✓ ' : '✗ '}{addStatus.msg}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}