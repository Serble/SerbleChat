import { useState, useEffect, useRef } from 'react';
import { createGuildInvite, FRONTEND_URL } from '../../api.js';
import { copyToClipboard } from '../../electron-utils.js';
import { Modal, ModalBody, ModalFooter, Button, ErrorBox, Hint, useFlashStatus } from '../ui/index.js';
import { MutedText } from './common.jsx';
import { LinkIcon, CheckIcon, ClipboardIcon } from '../../icons.jsx';

/** Quick "Invite People" dialog: creates a fresh invite on open. */
export default function InvitePopup({ guildId, onClose }) {
  const [invite, setInvite] = useState(null);
  const [busy, setBusy]     = useState(true);
  const [error, setError]   = useState(null);
  const [copied, flashCopied] = useFlashStatus();
  // Prevent double POST in React StrictMode (effect fires twice in dev)
  const fetchedRef = useRef(false);

  useEffect(() => {
    if (fetchedRef.current) return;
    fetchedRef.current = true;
    createGuildInvite(guildId)
      .then(setInvite)
      .catch(err => { console.error(err); setError(err.message || 'Failed to create invite.'); })
      .finally(() => setBusy(false));
  }, [guildId]);

  const link = invite ? `${FRONTEND_URL}/invite/${invite.id}` : '';

  function copyLink() {
    if (!link) return;
    copyToClipboard(link).catch(err => console.error('Failed to copy invite:', err));
    flashCopied(true, 2000);
  }

  return (
    <Modal onClose={onClose} title="Invite People" icon={LinkIcon} width={440}>
      <ModalBody>
        <Hint>Share this link with people you want to invite. Manage or revoke links under Guild Settings → Invites.</Hint>
        {busy && <MutedText>Creating invite link…</MutedText>}
        <ErrorBox>{error}</ErrorBox>
        {!busy && invite && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.3rem 0.3rem 0.3rem 0.75rem', border: '1px solid var(--border)', borderRadius: 6, background: 'var(--bg-input)' }}>
            <span style={{ flex: 1, minWidth: 0, fontFamily: 'ui-monospace, monospace', fontSize: '0.83rem', color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', userSelect: 'all' }}>
              {link}
            </span>
            <Button size="sm" variant={copied ? 'success' : 'primary'} onClick={copyLink} style={{ minWidth: 84 }}>
              {copied ? <><CheckIcon size={12} /> Copied</> : <><ClipboardIcon size={12} /> Copy</>}
            </Button>
          </div>
        )}
      </ModalBody>
      <ModalFooter>
        <Button variant="ghost" onClick={onClose}>Done</Button>
      </ModalFooter>
    </Modal>
  );
}
