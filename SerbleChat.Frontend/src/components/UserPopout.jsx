import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import { avatarBg, bannerBg, nameTextColor } from '../userColor.js';
import {
  getAccountById, getGuildRoles, getUserGuildRoles, addUserGuildRole, removeUserGuildRole,
  addFriend, removeFriend, getOrCreateDmChannel,
} from '../api.js';
import { useApp } from '../context/AppContext.jsx';

const BLURB_REMARK_PLUGINS = [remarkGfm, remarkBreaks];

/** Renders blurb markdown inside the popout with compact, themed styles. */
function BlurbMarkdown({ content }) {
  const components = {
    p:      ({ children }) => <p style={{ margin: '0 0 0.4em', lineHeight: 1.55 }}>{children}</p>,
    a:      ({ href, children }) => (
      <a href={href} target="_blank" rel="noopener noreferrer"
        style={{ color: 'var(--accent)', textDecoration: 'underline', wordBreak: 'break-all' }}>
        {children}
      </a>
    ),
    strong: ({ children }) => <strong style={{ color: 'var(--text-primary)', fontWeight: 700 }}>{children}</strong>,
    em:     ({ children }) => <em style={{ fontStyle: 'italic' }}>{children}</em>,
    code:   ({ children }) => (
      <code style={{
        background: 'rgba(255,255,255,0.08)', borderRadius: '3px',
        padding: '0.1em 0.35em', fontSize: '0.82em', fontFamily: 'monospace',
        color: 'var(--text-primary)',
      }}>{children}</code>
    ),
    pre:    ({ children }) => (
      <pre style={{
        background: 'var(--bg-tertiary)', borderRadius: '6px',
        padding: '0.5rem 0.65rem', overflowX: 'auto',
        fontSize: '0.78rem', lineHeight: 1.5, margin: '0.35em 0',
        border: '1px solid var(--border)',
      }}>{children}</pre>
    ),
    ul:     ({ children }) => <ul style={{ margin: '0.3em 0', paddingLeft: '1.2em' }}>{children}</ul>,
    ol:     ({ children }) => <ol style={{ margin: '0.3em 0', paddingLeft: '1.2em' }}>{children}</ol>,
    li:     ({ children }) => <li style={{ margin: '0.15em 0' }}>{children}</li>,
    blockquote: ({ children }) => (
      <blockquote style={{
        margin: '0.35em 0', paddingLeft: '0.65rem',
        borderLeft: '3px solid var(--accent)',
        color: 'var(--text-muted)', fontStyle: 'italic',
      }}>{children}</blockquote>
    ),
    h1: ({ children }) => <div style={{ fontSize: '1em', fontWeight: 700, margin: '0.4em 0 0.2em', color: 'var(--text-primary)' }}>{children}</div>,
    h2: ({ children }) => <div style={{ fontSize: '0.95em', fontWeight: 700, margin: '0.4em 0 0.2em', color: 'var(--text-primary)' }}>{children}</div>,
    h3: ({ children }) => <div style={{ fontSize: '0.9em', fontWeight: 700, margin: '0.4em 0 0.2em', color: 'var(--text-primary)' }}>{children}</div>,
    hr:  () => <hr style={{ border: 'none', borderTop: '1px solid var(--border)', margin: '0.5em 0' }} />,
    img: ({ src, alt }) => (
      <img src={src} alt={alt ?? ''} style={{ maxWidth: '100%', borderRadius: '4px', display: 'block', margin: '0.3em 0' }} />
    ),
  };
  return (
    <ReactMarkdown remarkPlugins={BLURB_REMARK_PLUGINS} components={components}>
      {content}
    </ReactMarkdown>
  );
}

const ONLINE  = { label: 'Online',  color: '#23a55a' };
const OFFLINE = { label: 'Offline', color: '#747f8d' };

function Avatar({ name, size = 64, color }) {
  const initial = name ? name[0].toUpperCase() : '?';
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      background: avatarBg(name, color),
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      color: '#fff', fontWeight: 700, fontSize: size * 0.42,
      flexShrink: 0, userSelect: 'none',
    }}>
      {initial}
    </div>
  );
}

const sectionLabel = {
  fontSize: '0.68rem', fontWeight: 700, color: 'var(--text-muted)',
  textTransform: 'uppercase', letterSpacing: '0.07em',
  marginBottom: '0.4rem',
};

function ActionButton({ label, icon, onClick, disabled, variant = 'default' }) {
  const [hov, setHov] = useState(false);
  const colors = {
    default: { bg: 'rgba(255,255,255,0.06)', bgHov: 'rgba(255,255,255,0.12)', border: 'var(--border)', color: 'var(--text-secondary)' },
    green:   { bg: 'rgba(35,165,90,0.12)',   bgHov: 'rgba(35,165,90,0.22)',   border: 'rgba(35,165,90,0.35)',   color: '#23a55a' },
    red:     { bg: 'rgba(242,63,67,0.10)',   bgHov: 'rgba(242,63,67,0.20)',   border: 'rgba(242,63,67,0.35)',   color: '#f23f43' },
    accent:  { bg: 'var(--accent)',          bgHov: 'var(--accent-hover)',     border: 'transparent',            color: '#fff'    },
  };
  const c = colors[variant] ?? colors.default;
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.35rem',
        padding: '0.45rem 0.5rem', borderRadius: '6px',
        background: hov && !disabled ? c.bgHov : c.bg,
        border: `1px solid ${c.border}`,
        color: c.color, fontSize: '0.8rem', fontWeight: 600,
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.55 : 1,
        transition: 'background 0.15s, color 0.15s',
        whiteSpace: 'nowrap',
      }}
    >
      {icon && <span style={{ fontSize: '0.85rem' }}>{icon}</span>}
      {label}
    </button>
  );
}

/**
 * UserPopout
 * Props: userId, username, anchorRect, onClose, guildId?
 */
export default function UserPopout({ userId, username, anchorRect, onClose, guildId }) {
  const nav = useNavigate();

  const [user, setUser]               = useState(null);
  const [guildRoles, setGuildRoles]   = useState([]);
  const [userRoleIds, setUserRoleIds] = useState(new Set());
  const [rolesLoaded, setRolesLoaded] = useState(false);
  const [rolesBusy, setRolesBusy]     = useState({});
  const [dropOpen, setDropOpen]       = useState(false);
  const [friendBusy, setFriendBusy]   = useState(false);
  const [msgBusy, setMsgBusy]         = useState(false);
  const [blockBusy, setBlockBusy]     = useState(false);
  const dropRef   = useRef(null);
  const popoutRef = useRef(null);

  const { getMyPerms, isBlocked, blockUser, unblockUser, currentUser, friends, refreshFriends } = useApp();
  const myPerms        = guildId ? getMyPerms(guildId) : null;
  const canManageRoles = !!myPerms && (myPerms.administrator === 0 || myPerms.manageRoles === 0);
  const isSelf         = currentUser?.id === userId;
  const blocked        = isBlocked ? isBlocked(userId) : false;

  // Derive friendship state
  const friendship = friends?.find(f =>
    (f.user1Id === currentUser?.id && f.user2Id === userId) ||
    (f.user1Id === userId && f.user2Id === currentUser?.id)
  ) ?? null;
  const isFriend        = !!friendship && !friendship.pending;
  const isOutgoing      = !!friendship && friendship.pending && friendship.user1Id === currentUser?.id;
  const isIncoming      = !!friendship && friendship.pending && friendship.user2Id === currentUser?.id;

  // Fetch user profile
  useEffect(() => {
    getAccountById(userId).then(setUser).catch(() => setUser(null));
  }, [userId]);

  // Fetch guild roles + user's assigned roles
  useEffect(() => {
    if (!guildId) return;
    setRolesLoaded(false);
    setUserRoleIds(new Set());
    setGuildRoles([]);
    Promise.all([getGuildRoles(guildId), getUserGuildRoles(guildId, userId)])
      .then(([all, assigned]) => {
        const allSafe      = Array.isArray(all)      ? all      : [];
        const assignedSafe = Array.isArray(assigned) ? assigned : [];
        setGuildRoles(allSafe);
        setUserRoleIds(new Set(assignedSafe.map(r => Number(r.id ?? r.Id))));
      }).catch(console.error).finally(() => setRolesLoaded(true));
  }, [guildId, userId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Close on Escape / outside click
  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') { if (dropOpen) setDropOpen(false); else onClose(); } }
    function onDown(e) {
      if (dropRef.current?.contains(e.target)) return;
      if (popoutRef.current && !popoutRef.current.contains(e.target)) onClose();
    }
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('mousedown', onDown); };
  }, [onClose, dropOpen]);

  async function toggleRole(role) {
    const roleId = Number(role.id ?? role.Id);
    setRolesBusy(p => ({ ...p, [roleId]: true }));
    try {
      if (userRoleIds.has(roleId)) {
        await removeUserGuildRole(guildId, userId, roleId);
        setUserRoleIds(p => { const n = new Set(p); n.delete(roleId); return n; });
      } else {
        await addUserGuildRole(guildId, userId, roleId);
        setUserRoleIds(p => new Set([...p, roleId]));
      }
    } catch (e) { console.error(e); }
    finally { setRolesBusy(p => ({ ...p, [roleId]: false })); }
  }

  async function handleMessage() {
    setMsgBusy(true);
    try {
      const ch = await getOrCreateDmChannel(userId);
      onClose();
      nav(`/app/channel/${ch.id}`);
    } catch (e) { console.error(e); }
    finally { setMsgBusy(false); }
  }

  async function handleAddFriend()    { setFriendBusy(true); try { await addFriend(userId);     refreshFriends(); } catch(e){ console.error(e); } finally { setFriendBusy(false); } }
  async function handleAccept()       { setFriendBusy(true); try { await addFriend(friendship.user1Id); refreshFriends(); } catch(e){ console.error(e); } finally { setFriendBusy(false); } }
  async function handleRemoveFriend() { setFriendBusy(true); try { await removeFriend(userId);  refreshFriends(); } catch(e){ console.error(e); } finally { setFriendBusy(false); } }

  async function handleToggleBlock() {
    if (blockBusy || isSelf) return;
    setBlockBusy(true);
    try { blocked ? await unblockUser(userId) : await blockUser(userId); }
    catch (e) { console.error(e); }
    finally { setBlockBusy(false); }
  }

  // Positioning — widen to 320px, clamp vertically with more breathing room
  const POPOUT_W = 320;
  const GAP = 8;
  let left = anchorRect.right + GAP;
  let top  = anchorRect.top;
  if (left + POPOUT_W > window.innerWidth - 8) left = anchorRect.left - POPOUT_W - GAP;
  if (left < 8) left = 8;
  const estimatedH = 480;
  if (top + estimatedH > window.innerHeight - 8) top = window.innerHeight - estimatedH - 8;
  if (top < 8) top = 8;

  const sm          = user ? (user.isOnline ? ONLINE : OFFLINE) : null;
  const displayName = user?.username ?? username;
  const sortedRoles   = guildRoles.slice().sort((a, b) => b.priority - a.priority);
  const assignedRoles = sortedRoles.filter(r =>  userRoleIds.has(Number(r.id ?? r.Id)));

  return (
    <div
      ref={popoutRef}
      style={{
        position: 'fixed', zIndex: 600, top, left, width: POPOUT_W,
        background: 'var(--bg-overlay)', border: '1px solid var(--border)', borderRadius: '10px',
        boxShadow: '0 12px 40px rgba(0,0,0,0.6)', overflow: 'hidden',
        userSelect: 'none', maxHeight: 'calc(100vh - 16px)',
        display: 'flex', flexDirection: 'column',
      }}
    >
      {/* Banner */}
      <div style={{ height: 60, flexShrink: 0, background: bannerBg(displayName, user?.color) }} />

      {/* Avatar row */}
      <div style={{ position: 'relative', padding: '0 1rem', flexShrink: 0 }}>
        <div style={{ position: 'absolute', top: -34, background: 'var(--bg-overlay)', borderRadius: '50%', padding: 3, outline: sm ? `3px solid ${sm.color}` : 'none', outlineOffset: 1 }}>
          <Avatar name={displayName} size={60} color={user?.color} />
        </div>
      </div>

      {/* Scrollable body */}
      <div style={{ overflowY: 'auto', flex: 1 }}>
        <div style={{ padding: '2.2rem 1rem 0.75rem' }}>

          {/* Name + status */}
          <div style={{ fontWeight: 800, fontSize: '1.05rem', color: nameTextColor(displayName, user?.color), marginBottom: '0.15rem' }}>{displayName}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.9rem' }}>
            <div style={{ width: 9, height: 9, borderRadius: '50%', background: sm?.color ?? 'var(--text-subtle)', flexShrink: 0 }} />
            <span style={{ fontSize: '0.78rem', color: sm?.color ?? 'var(--text-subtle)', fontWeight: 600 }}>{sm?.label ?? '…'}</span>
          </div>

          {/* ── Action buttons (Message + Friend) ── */}
          {!isSelf && (
            <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.85rem' }}>
              <ActionButton
                label={msgBusy ? '…' : 'Message'}
                icon="💬"
                onClick={handleMessage}
                disabled={msgBusy}
                variant="default"
              />
              {!isFriend && !isOutgoing && !isIncoming && (
                <ActionButton label={friendBusy ? '…' : 'Add Friend'} icon="➕" onClick={handleAddFriend} disabled={friendBusy} variant="green" />
              )}
              {isOutgoing && (
                <ActionButton label={friendBusy ? '…' : 'Cancel Request'} icon="✕" onClick={handleRemoveFriend} disabled={friendBusy} variant="red" />
              )}
              {isIncoming && (
                <>
                  <ActionButton label={friendBusy ? '…' : 'Accept'} icon="✓" onClick={handleAccept}       disabled={friendBusy} variant="green" />
                  <ActionButton label={friendBusy ? '…' : 'Ignore'} icon="✕" onClick={handleRemoveFriend} disabled={friendBusy} variant="red"   />
                </>
              )}
              {isFriend && (
                <ActionButton label={friendBusy ? '…' : 'Remove Friend'} icon="👋" onClick={handleRemoveFriend} disabled={friendBusy} variant="red" />
              )}
            </div>
          )}

          <div style={{ height: 1, background: 'var(--border)', margin: '0 0 0.65rem' }} />

          {/* About Me */}
          {user?.blurb && (
            <>
              <div style={sectionLabel}>About Me</div>
              <div style={{
                fontSize: '0.83rem', color: 'var(--text-secondary)', lineHeight: 1.55,
                padding: '0.4rem 0.5rem', background: 'var(--bg-tertiary)', borderRadius: '6px',
                marginBottom: '0.75rem', wordBreak: 'break-word',
              }}>
                <BlurbMarkdown content={user.blurb} />
              </div>
            </>
          )}

          {/* User ID */}
          <div style={sectionLabel}>User ID</div>
          <div
            title="Click to copy" onClick={() => navigator.clipboard?.writeText(userId)}
            style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', fontFamily: 'monospace', cursor: 'pointer', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', padding: '0.25rem 0.4rem', background: 'var(--bg-tertiary)', borderRadius: '4px', transition: 'background 0.1s' }}
            onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-secondary)'}
            onMouseLeave={e => e.currentTarget.style.background = 'var(--bg-tertiary)'}
          >{userId}</div>
        </div>

        {/* ── Guild Roles ── */}
        {guildId && rolesLoaded && (
          <div style={{ padding: '0 1rem 1rem' }}>
            <div style={{ height: 1, background: 'var(--border)', margin: '0 0 0.75rem' }} />
            <div style={sectionLabel}>Roles</div>
            {assignedRoles.length === 0 ? (
              <div style={{ fontSize: '0.8rem', color: 'var(--text-subtle)', marginBottom: '0.5rem' }}>No roles</div>
            ) : (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem', marginBottom: '0.5rem' }}>
                {assignedRoles.map(role => (
                  <span key={role.id ?? role.Id} style={{
                    display: 'inline-flex', alignItems: 'center', gap: '0.3rem',
                    background: 'rgba(255,255,255,0.07)', borderRadius: '4px',
                    padding: '0.2rem 0.5rem', fontSize: '0.78rem', fontWeight: 600,
                    color: role.color || 'var(--text-secondary)',
                    border: `1px solid ${role.color ? role.color + '55' : 'var(--border)'}`,
                  }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: role.color || 'var(--text-muted)', flexShrink: 0, display: 'inline-block' }} />
                    {role.name}
                  </span>
                ))}
              </div>
            )}

            {canManageRoles && guildRoles.length > 0 && (
              <div style={{ position: 'relative', marginTop: '0.35rem' }} ref={dropRef}>
                <button
                  onClick={() => setDropOpen(v => !v)}
                  style={{
                    width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: '6px',
                    padding: '0.4rem 0.6rem', color: 'var(--text-secondary)', fontSize: '0.8rem',
                    cursor: 'pointer', transition: 'border-color 0.15s',
                  }}
                  onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--accent)'}
                  onMouseLeave={e => e.currentTarget.style.borderColor = dropOpen ? 'var(--accent)' : 'var(--border)'}
                >
                  <span>Manage roles…</span>
                  <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>{dropOpen ? '▲' : '▼'}</span>
                </button>
                {dropOpen && (
                  <div style={{
                    position: 'absolute', bottom: 'calc(100% + 4px)', left: 0, right: 0,
                    background: 'var(--bg-overlay)', border: '1px solid var(--border)', borderRadius: '6px',
                    boxShadow: '0 8px 24px rgba(0,0,0,0.5)', maxHeight: 220, overflowY: 'auto', zIndex: 10,
                  }}>
                    {sortedRoles.map(role => {
                      const roleId = Number(role.id ?? role.Id);
                      const has    = userRoleIds.has(roleId);
                      const busy   = !!rolesBusy[roleId];
                      return (
                        <div key={roleId} onClick={() => !busy && toggleRole(role)}
                          style={{ display: 'flex', alignItems: 'center', gap: '0.55rem', padding: '0.45rem 0.65rem', cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.5 : 1, transition: 'background 0.1s', background: 'transparent' }}
                          onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-secondary)'}
                          onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                        >
                          <div style={{ width: 16, height: 16, borderRadius: '3px', flexShrink: 0, background: has ? 'var(--accent)' : 'transparent', border: `2px solid ${has ? 'var(--accent)' : 'var(--text-subtle)'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.15s' }}>
                            {has && <span style={{ color: '#fff', fontSize: '0.6rem', fontWeight: 900, lineHeight: 1 }}>✓</span>}
                          </div>
                          <span style={{ width: 10, height: 10, borderRadius: '50%', flexShrink: 0, background: role.color || 'var(--text-muted)', border: '1px solid rgba(255,255,255,0.1)' }} />
                          <span style={{ flex: 1, fontSize: '0.83rem', fontWeight: 500, color: has ? 'var(--text-primary)' : 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{role.name}</span>
                          {busy && <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>…</span>}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        <div style={{ height: 4 }} />
      </div>

      {/* ── Block / Unblock footer ── */}
      {!isSelf && (
        <div style={{ padding: '0 1rem 0.85rem', flexShrink: 0 }}>
          <div style={{ height: 1, background: 'var(--border)', marginBottom: '0.65rem' }} />
          <button
            onClick={handleToggleBlock}
            disabled={blockBusy}
            style={{
              width: '100%', padding: '0.45rem 0.75rem', borderRadius: '6px',
              background: blocked ? 'rgba(242,63,67,0.12)' : 'rgba(255,255,255,0.04)',
              border: `1px solid ${blocked ? 'rgba(242,63,67,0.35)' : 'var(--border)'}`,
              color: blocked ? '#f23f43' : 'var(--text-muted)',
              fontSize: '0.82rem', fontWeight: 600,
              cursor: blockBusy ? 'default' : 'pointer',
              opacity: blockBusy ? 0.6 : 1,
              display: 'flex', alignItems: 'center', gap: '0.5rem',
              transition: 'background 0.15s, border-color 0.15s, color 0.15s',
            }}
            onMouseEnter={e => { if (!blockBusy) { e.currentTarget.style.background = blocked ? 'rgba(242,63,67,0.22)' : 'rgba(242,63,67,0.1)'; e.currentTarget.style.color = '#f23f43'; e.currentTarget.style.borderColor = 'rgba(242,63,67,0.4)'; } }}
            onMouseLeave={e => { if (!blockBusy) { e.currentTarget.style.background = blocked ? 'rgba(242,63,67,0.12)' : 'rgba(255,255,255,0.04)'; e.currentTarget.style.color = blocked ? '#f23f43' : 'var(--text-muted)'; e.currentTarget.style.borderColor = blocked ? 'rgba(242,63,67,0.35)' : 'var(--border)'; } }}
          >
            <span>🚫</span>
            {blockBusy ? '…' : blocked ? 'Unblock User' : 'Block User'}
          </button>
        </div>
      )}
    </div>
  );
}
