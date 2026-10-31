import { useState, useEffect } from 'react';
import { useApp } from '../context/AppContext.jsx';
import { addGroupChatMembers, getChannelMembers } from '../api.js';
import { Modal, Button, ErrorBox, Hint } from './ui/index.js';
import FriendPicker, { friendIdOf } from './FriendPicker.jsx';

/**
 * groupId: number (the group's channel id), onClose: fn
 * existingMemberIds: Set<string> (optional) — members to hide; the current
 * member list is also fetched here so existing members are never offered.
 */
export default function AddMembersModal({ groupId, existingMemberIds, onClose }) {
  const { friends, currentUser } = useApp();
  const [selected,  setSelected]  = useState(new Set());
  const [memberIds, setMemberIds] = useState(null); // Set<string> once loaded
  const [busy,      setBusy]      = useState(false);
  const [error,     setError]     = useState(null);

  useEffect(() => {
    let cancelled = false;
    getChannelMembers(groupId)
      .then(members => { if (!cancelled) setMemberIds(new Set(members.map(m => String(m.id)))); })
      .catch(err => {
        console.error('Failed to load group members:', err);
        if (!cancelled) setMemberIds(new Set());
      });
    return () => { cancelled = true; };
  }, [groupId]);

  // Friends not already in the group
  const eligibleIds = friends
    .filter(f => !f.pending)
    .map(f => friendIdOf(f, currentUser?.id))
    .filter(id => !existingMemberIds?.has(id) && !memberIds?.has(String(id)));
  const picked = eligibleIds.filter(id => selected.has(id));

  function toggle(id) {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  async function handleAdd(e) {
    e.preventDefault();
    if (busy) return;
    if (picked.length === 0) { setError('Select at least one friend.'); return; }
    setBusy(true); setError(null);
    try {
      await addGroupChatMembers(groupId, picked);
      onClose();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <Modal onClose={onClose} title="Add Members" width={440}>
      <form onSubmit={handleAdd} style={{ padding: '1.25rem 1.5rem', display: 'flex', flexDirection: 'column', gap: '0.875rem', flex: '1 1 auto', minHeight: 0 }}>
        <Hint>Pick friends to add to this group.</Hint>

        <FriendPicker
          label="Friends"
          userIds={eligibleIds}
          selected={selected}
          onToggle={toggle}
          loading={memberIds === null}
          emptyText="All your friends are already in this group."
          listStyle={{ maxHeight: 240 }}
        />

        <ErrorBox>{error}</ErrorBox>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', flexShrink: 0 }}>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" disabled={busy || picked.length === 0}>
            {busy ? 'Adding…' : 'Add Members'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
