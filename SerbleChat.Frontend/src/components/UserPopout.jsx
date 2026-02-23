import { useState, useEffect, useRef } from 'react';
import { getAccountById, getGuildRoles, getUserGuildRoles, addUserGuildRole, removeUserGuildRole } from '../api.js';
import { useApp } from '../context/AppContext.jsx';

const ONLINE  = { label: 'Online',  color: '#23a55a' };
const OFFLINE = { label: 'Offline', color: '#747f8d' };

function Avatar({ name, size = 64 }) {
  const initial = name ? name[0].toUpperCase() : '?';
  const hue = name ? (name.charCodeAt(0) * 37 + name.charCodeAt(name.length - 1) * 17) % 360 : 200;
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      background: `hsl(${hue},45%,40%)`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      color: '#fff', fontWeight: 700, fontSize: size * 0.42,
      flexShrink: 0, userSelect: 'none',
    }}>
      {initial}
    </div>
  );
}

const sectionLabel = {
  fontSize: '0.68rem', fontWeight: 700, color: '#72767d',
  textTransform: 'uppercase', letterSpacing: '0.07em',
  marginBottom: '0.4rem',
};

/**
 * UserPopout
 * Props: userId, username, anchorRect, onClose, guildId?
 */
export default function UserPopout({ userId, username, anchorRect, onClose, guildId }) {
  const [user, setUser]               = useState(null);
  const [guildRoles, setGuildRoles]   = useState([]);       // all roles in this guild
  const [userRoleIds, setUserRoleIds] = useState(new Set()); // Set<number> — IDs the target user has
  const [rolesLoaded, setRolesLoaded] = useState(false);
  const [rolesBusy, setRolesBusy]     = useState({});       // roleId -> bool
  const [dropOpen, setDropOpen]       = useState(false);
  const dropRef = useRef(null);
  const popoutRef = useRef(null);

  const { getMyPerms } = useApp();
  const myPerms        = guildId ? getMyPerms(guildId) : null;
  const canManageRoles = !!myPerms && (myPerms.administrator === 0 || myPerms.manageRoles === 0);

  // Fetch user profile
  useEffect(() => {
    getAccountById(userId).then(setUser).catch(() => setUser(null));
  }, [userId]);

  // Fetch all guild roles + this user's assigned roles
  useEffect(() => {
    if (!guildId) return;
    setRolesLoaded(false);
    setUserRoleIds(new Set());
    setGuildRoles([]);
    Promise.all([
      getGuildRoles(guildId),
      getUserGuildRoles(guildId, userId),
    ]).then(([all, assigned]) => {
      const allSafe      = Array.isArray(all)      ? all      : [];
      const assignedSafe = Array.isArray(assigned) ? assigned : [];
      setGuildRoles(allSafe);
      // Normalise IDs: backend serialises as camelCase `id` (number)
      // Use both .id and .Id defensively in case serialisation differs
      setUserRoleIds(new Set(assignedSafe.map(r => Number(r.id ?? r.Id))));
    }).catch(console.error).finally(() => setRolesLoaded(true));
  }, [guildId, userId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Close popout on Escape / outside click
  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') { if (dropOpen) setDropOpen(false); else onClose(); } }
    function onDown(e) {
      if (dropRef.current?.contains(e.target)) return; // click inside dropdown — handled separately
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

  // Positioning
  const POPOUT_W = 270;
  const GAP = 8;
  let left = anchorRect.right + GAP;
  let top  = anchorRect.top;
  if (left + POPOUT_W > window.innerWidth - 8) left = anchorRect.left - POPOUT_W - GAP;
  if (left < 8) left = 8;
  if (top + 320 > window.innerHeight - 8) top = window.innerHeight - 320 - 8;
  if (top < 8) top = 8;

  const sm          = user ? (user.isOnline ? ONLINE : OFFLINE) : null;
  const displayName = user?.username ?? username;

  // Derive display data
  const sortedRoles     = guildRoles.slice().sort((a, b) => b.priority - a.priority);
  const assignedRoles   = sortedRoles.filter(r => userRoleIds.has(Number(r.id ?? r.Id)));
  const unassignedRoles = sortedRoles.filter(r => !userRoleIds.has(Number(r.id ?? r.Id)));

  return (
    <div
      ref={popoutRef}
      style={{
        position: 'fixed', zIndex: 600, top, left, width: POPOUT_W,
        background: '#1e1f22', border: '1px solid #3b3d43', borderRadius: '10px',
        boxShadow: '0 12px 40px rgba(0,0,0,0.6)', overflow: 'hidden',
        userSelect: 'none', maxHeight: 'calc(100vh - 16px)',
        display: 'flex', flexDirection: 'column',
      }}
    >
      {/* Banner */}
      <div style={{ height: 52, flexShrink: 0, background: `hsl(${displayName ? (displayName.charCodeAt(0) * 37 + displayName.charCodeAt(displayName.length - 1) * 17) % 360 : 200},35%,22%)` }} />

      {/* Avatar */}
      <div style={{ position: 'relative', padding: '0 1rem', flexShrink: 0 }}>
        <div style={{ position: 'absolute', top: -32, background: '#1e1f22', borderRadius: '50%', padding: 3, outline: sm ? `3px solid ${sm.color}` : 'none', outlineOffset: 1 }}>
          <Avatar name={displayName} size={56} />
        </div>
      </div>

      {/* Scrollable body */}
      <div style={{ overflowY: 'auto', flex: 1 }}>
        <div style={{ padding: '2rem 1rem 0.75rem' }}>
          <div style={{ fontWeight: 800, fontSize: '1rem', color: '#f2f3f5', marginBottom: '0.2rem' }}>{displayName}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.75rem' }}>
            <div style={{ width: 9, height: 9, borderRadius: '50%', background: sm?.color ?? '#747f8d', flexShrink: 0 }} />
            <span style={{ fontSize: '0.78rem', color: sm?.color ?? '#747f8d', fontWeight: 600 }}>{sm?.label ?? '…'}</span>
          </div>
          <div style={{ height: 1, background: '#3b3d43', margin: '0 0 0.65rem' }} />
          <div style={sectionLabel}>User ID</div>
          <div
            title="Click to copy" onClick={() => navigator.clipboard?.writeText(userId)}
            style={{ fontSize: '0.78rem', color: '#b5bac1', fontFamily: 'monospace', cursor: 'pointer', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', padding: '0.25rem 0.4rem', background: '#111214', borderRadius: '4px', transition: 'background 0.1s' }}
            onMouseEnter={e => e.currentTarget.style.background = '#2b2d31'}
            onMouseLeave={e => e.currentTarget.style.background = '#111214'}
          >{userId}</div>
        </div>

        {/* ── Guild Roles section ───────────────────────────────────────── */}
        {guildId && rolesLoaded && (
          <div style={{ padding: '0 1rem 1rem' }}>
            <div style={{ height: 1, background: '#3b3d43', margin: '0 0 0.75rem' }} />

            {/* ── Assigned roles display ── */}
            <div style={sectionLabel}>Roles</div>

            {assignedRoles.length === 0 ? (
              <div style={{ fontSize: '0.8rem', color: '#4f5660', marginBottom: '0.5rem' }}>No roles</div>
            ) : (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem', marginBottom: '0.5rem' }}>
                {assignedRoles.map(role => (
                  <span key={role.id ?? role.Id} style={{
                    display: 'inline-flex', alignItems: 'center', gap: '0.3rem',
                    background: 'rgba(255,255,255,0.07)', borderRadius: '4px',
                    padding: '0.2rem 0.5rem', fontSize: '0.78rem', fontWeight: 600,
                    color: role.color || '#dbdee1',
                    border: `1px solid ${role.color ? role.color + '55' : '#3b3d43'}`,
                  }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: role.color || '#99aab5', flexShrink: 0, display: 'inline-block' }} />
                    {role.name}
                  </span>
                ))}
              </div>
            )}

            {/* ── Manage roles dropdown (ManageRoles / admin only) ── */}
            {canManageRoles && guildRoles.length > 0 && (
              <div style={{ position: 'relative', marginTop: '0.35rem' }} ref={dropRef}>
                <button
                  onClick={() => setDropOpen(v => !v)}
                  style={{
                    width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    background: '#2b2d31', border: '1px solid #3b3d43', borderRadius: '6px',
                    padding: '0.4rem 0.6rem', color: '#b5bac1', fontSize: '0.8rem',
                    cursor: 'pointer', transition: 'border-color 0.15s',
                  }}
                  onMouseEnter={e => e.currentTarget.style.borderColor = '#7c3aed'}
                  onMouseLeave={e => e.currentTarget.style.borderColor = dropOpen ? '#7c3aed' : '#3b3d43'}
                >
                  <span>Manage roles…</span>
                  <span style={{ fontSize: '0.65rem', color: '#72767d' }}>{dropOpen ? '▲' : '▼'}</span>
                </button>

                {dropOpen && (
                  <div style={{
                    position: 'absolute', bottom: 'calc(100% + 4px)', left: 0, right: 0,
                    background: '#111214', border: '1px solid #3b3d43', borderRadius: '6px',
                    boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
                    maxHeight: 220, overflowY: 'auto', zIndex: 10,
                  }}>
                    {sortedRoles.map(role => {
                      const roleId = Number(role.id ?? role.Id);
                      const has    = userRoleIds.has(roleId);
                      const busy   = !!rolesBusy[roleId];
                      return (
                        <div
                          key={roleId}
                          onClick={() => !busy && toggleRole(role)}
                          style={{
                            display: 'flex', alignItems: 'center', gap: '0.55rem',
                            padding: '0.45rem 0.65rem',
                            cursor: busy ? 'default' : 'pointer',
                            opacity: busy ? 0.5 : 1,
                            transition: 'background 0.1s',
                            background: 'transparent',
                          }}
                          onMouseEnter={e => e.currentTarget.style.background = '#1e1f22'}
                          onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                        >
                          {/* Checkbox */}
                          <div style={{
                            width: 16, height: 16, borderRadius: '3px', flexShrink: 0,
                            background: has ? '#7c3aed' : 'transparent',
                            border: `2px solid ${has ? '#7c3aed' : '#4f5660'}`,
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            transition: 'all 0.15s',
                          }}>
                            {has && <span style={{ color: '#fff', fontSize: '0.6rem', fontWeight: 900, lineHeight: 1 }}>✓</span>}
                          </div>
                          {/* Colour dot */}
                          <span style={{ width: 10, height: 10, borderRadius: '50%', flexShrink: 0, background: role.color || '#99aab5', border: '1px solid rgba(255,255,255,0.1)' }} />
                          {/* Name */}
                          <span style={{ flex: 1, fontSize: '0.83rem', fontWeight: 500, color: has ? '#f2f3f5' : '#72767d', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {role.name}
                          </span>
                          {busy && <span style={{ fontSize: '0.7rem', color: '#72767d' }}>…</span>}
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
    </div>
  );
}
