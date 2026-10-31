import { useState, useEffect, useRef } from 'react';
import { createGuildInvite, FRONTEND_URL } from '../../api.js';
import { copyToClipboard } from '../../electron-utils.js';
import { Modal, Button, ErrorBox, useFlashStatus } from '../ui/index.js';
import { MutedText } from './common.jsx';
import { LinkIcon, CheckIcon } from '../../icons.jsx';

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
    <Modal onClose={onClose} title="Invite People" icon={LinkIcon} width={400}>
      <div style={{ padding: '1.25rem 1.5rem 1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        {busy && <MutedText>Creating invite link…</MutedText>}
        <ErrorBox>{error}</ErrorBox>
        {!busy && invite && (
          <>
            <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>Share this link with people you want to invite:</div>
            <div style={{ background: 'var(--bg-secondary)', borderRadius: 6, padding: '0.65rem 0.75rem', fontFamily: 'monospace', fontSize: '0.82rem', color: 'var(--text-secondary)', wordBreak: 'break-all', userSelect: 'all' }}>
              {link}
            </div>
            <Button variant={copied ? 'success' : 'primary'} onClick={copyLink} style={{ padding: '0.65rem' }}>
              {copied ? <><CheckIcon size={12} /> Copied to Clipboard!</> : 'Copy Invite Link'}
            </Button>
          </>
        )}
      </div>
    </Modal>
  );
}
