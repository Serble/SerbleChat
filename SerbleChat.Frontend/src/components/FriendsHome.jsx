import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../context/AppContext.jsx';
import { addFriend, removeFriend, getAccountByUsername, getOrCreateDmChannel } from '../api.js';
import UserInteraction from './UserInteraction.jsx';
import { useMobile } from '../context/MobileContext.jsx';
import Avatar from './Avatar.jsx';
import { friendIdOf } from './FriendPicker.jsx';
import { Button, IconButton, TextInput, ErrorBox } from './ui/index.js';
import { MenuIcon, PeopleIcon, HandshakeIcon, MailboxIcon, BlockIcon, CheckIcon, CrossIcon } from '../icons.jsx';

const TABS = ['All', 'Pending', 'Blocked', 'Add Friend'];

// Not a theme colour — there's no "warning" theme var.
const PENDING_COLOR = 'var(--warning)';

/** Translucent tint of a colour (works with CSS vars, unlike hex-alpha suffixes). */
function tint(color, pct) {
  return `color-mix(in srgb, ${color} ${pct}%, transparent)`;
}

function Pill({ label, color = 'var(--accent)' }) {
  return (
    <span style={{
      padding: '0.2rem 0.65rem', borderRadius: '9999px',
      background: tint(color, 13), color, fontSize: '0.75rem', fontWeight: 600,
      border: `1px solid ${tint(color, 27)}`,
    }}>
      {label}
    </span>
  );
}

/** tone: 'danger' (uses the shared danger button) | 'success' */
function ActionBtn({ label, tone, onClick, disabled }) {
  const [hovered, setHovered] = useState(false);
  if (tone === 'danger') {
    return <Button variant="danger" size="sm" onClick={onClick} disabled={disabled}>{label}</Button>;
  }
  // No success variant in the shared Button, so hover is handled here.
  const hot = hovered && !disabled;
  return (
    <Button
      size="sm"
      onClick={onClick}
      disabled={disabled}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: hot ? 'var(--success)' : tint('var(--success)', 13),
        color: hot ? '#fff' : 'var(--success)',
        borderColor: tint('var(--success)', 33),
      }}
    >
      {label}
    </Button>
  );
}

/** Uppercase "Heading — count" label above a list. */
function ListHeader({ children, style }) {
  return (
    <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: '0.25rem', ...style }}>
      {children}
    </div>
  );
}

const rowStyle = {
  display: 'flex', alignItems: 'center', gap: '0.875rem',
  padding: '0.65rem 1rem', borderRadius: '8px',
  borderBottom: '1px solid var(--border)',
  transition: 'background 0.1s',
};

function FriendRow({ friendship, currentUserId, onRefresh }) {
  const { resolveUser } = useApp();
  const nav = useNavigate();
  const [user, setUser] = useState(null);
  const [busy, setBusy] = useState(false);

  const otherId = friendIdOf(friendship, currentUserId);
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
    <div className="hov-bg" style={rowStyle}>
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
            <ActionBtn label="Message" tone="success" onClick={handleMessage} disabled={busy} />
            <ActionBtn label="Remove"  tone="danger"  onClick={handleRemove}  disabled={busy} />
          </>
        )}
        {isIncoming && (
          <>
            <ActionBtn label="Accept" tone="success" onClick={handleAccept} disabled={busy} />
            <ActionBtn label="Ignore" tone="danger"  onClick={handleRemove} disabled={busy} />
          </>
        )}
        {isOutgoing && (
          <>
            <Pill label="Pending" color={PENDING_COLOR} />
            <ActionBtn label="Cancel" tone="danger" onClick={handleRemove} disabled={busy} />
          </>
        )}
      </div>
    </div>
  );
}

function EmptyState({ icon: Icon, title, text }) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', padding: '4rem 2rem', textAlign: 'center',
    }}>
      <div style={{ marginBottom: '1rem' }}>{Icon && <Icon size={48} />}</div>
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
    <div className="hov-bg" style={rowStyle}>
      <Avatar userId={user.id} name={user?.username} color={user?.color} />
      <div style={{ flex: 1, overflow: 'hidden' }}>
        <div style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '0.9rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {user?.username ?? '…'}
        </div>
        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.1rem' }}>Blocked</div>
      </div>
      <ActionBtn label="Unblock" tone="danger" onClick={handleUnblock} disabled={busy} />
    </div>
  );
}

export default function FriendsHome() {
  const { friends, currentUser, refreshFriends, blockedUsers, unblockUser } = useApp();
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
          <IconButton
            title="Open sidebar"
            aria-label="Open sidebar"
            onClick={openSidebar}
            style={{ color: 'var(--text-secondary)', padding: '0.25rem', marginRight: '0.25rem', flexShrink: 0 }}
          ><MenuIcon size={18} /></IconButton>
        )}
        <span style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontWeight: 700, color: 'var(--text-primary)', marginRight: '0.75rem', fontSize: '0.95rem', flexShrink: 0 }}>
          <PeopleIcon size={16} /> Friends
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
              className={isActive ? undefined : 'hov-bg hov-text-secondary'}
              style={{
                padding: '0.25rem 0.75rem', borderRadius: '4px', border: 'none',
                background: isActive ? 'var(--bg-active)' : 'transparent',
                color: isActive ? 'var(--text-primary)' : 'var(--text-muted)',
                fontWeight: isActive ? 600 : 400, fontSize: '0.875rem',
                cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.4rem',
                transition: 'background 0.1s, color 0.1s', whiteSpace: 'nowrap', flexShrink: 0,
              }}
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
            <ListHeader>All Friends — {accepted.length}</ListHeader>
            {accepted.length === 0 ? (
              <EmptyState icon={HandshakeIcon} title="No friends yet" text="Add friends to start chatting." />
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
              <EmptyState icon={MailboxIcon} title="No pending requests" text="You're all caught up!" />
            ) : (
              <>
                {incoming.length > 0 && (
                  <>
                    <ListHeader>Incoming — {incoming.length}</ListHeader>
                    {incoming.map(f => (
                      <FriendRow key={f.id} friendship={f} currentUserId={myId} onRefresh={refreshFriends} />
                    ))}
                  </>
                )}
                {outgoing.length > 0 && (
                  <>
                    <ListHeader style={{ marginTop: incoming.length > 0 ? '1rem' : 0 }}>Outgoing — {outgoing.length}</ListHeader>
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
            <ListHeader>Blocked — {blockedUsers.length}</ListHeader>
            {blockedUsers.length === 0 ? (
              <EmptyState icon={BlockIcon} title="No blocked users" text="Users you block will appear here." />
            ) : (
              blockedUsers.map(u => (
                <BlockedRow
                  key={u.id}
                  user={u}
                  onUnblock={unblockUser}
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
              <TextInput
                style={{ flex: 1, width: 'auto', minWidth: 0, background: 'var(--bg-tertiary)', borderRadius: '8px', padding: '0.7rem 1rem' }}
                placeholder="Enter a username…"
                value={addInput}
                onChange={e => setAddInput(e.target.value)}
                disabled={addBusy}
              />
              <Button
                variant="primary"
                type="submit"
                disabled={!addInput.trim() || addBusy}
                style={{ padding: '0.7rem 1.5rem', borderRadius: '8px', fontWeight: 700 }}
              >
                {addBusy ? 'Sending…' : 'Send Request'}
              </Button>
            </form>
            {addStatus && (addStatus.ok ? (
              <div style={{
                marginTop: '0.75rem', padding: '0.65rem 1rem', borderRadius: '6px',
                background: tint('var(--success)', 15), color: 'var(--success)',
                fontSize: '0.85rem', border: `1px solid ${tint('var(--success)', 30)}`,
              }}>
                <CheckIcon size={14} /> {addStatus.msg}
              </div>
            ) : (
              <ErrorBox style={{ marginTop: '0.75rem' }}>
                <CrossIcon size={14} /> {addStatus.msg}
              </ErrorBox>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}