import { useState, useCallback } from 'react';
import Modal, { ModalBody, ModalFooter } from './Modal.jsx';
import { Button, ErrorBox } from './controls.jsx';

/**
 * Small "are you sure?" dialog. `onConfirm` may be async: the dialog stays
 * open (buttons disabled) while it runs and shows its error if it throws.
 */
export default function ConfirmModal({
  title, message, confirmLabel = 'Confirm', busyLabel, danger = true,
  onConfirm, onCancel,
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function confirm() {
    if (busy) return;
    setBusy(true); setError(null);
    try { await onConfirm(); }
    catch (e) { setError(e.message); setBusy(false); }
  }

  return (
    <Modal onClose={() => { if (!busy) onCancel(); }} title={title} width={420} onSubmit={confirm}>
      <ModalBody>
        <div style={{ fontSize: '0.9rem', lineHeight: 1.55, color: 'var(--text-secondary)' }}>{message}</div>
        <ErrorBox>{error}</ErrorBox>
      </ModalBody>
      <ModalFooter>
        <Button variant="ghost" onClick={onCancel} disabled={busy}>Cancel</Button>
        <Button type="submit" variant={danger ? 'danger-solid' : 'primary'} disabled={busy} autoFocus>
          {busy ? (busyLabel ?? `${confirmLabel}…`) : confirmLabel}
        </Button>
      </ModalFooter>
    </Modal>
  );
}

/**
 * `const [confirm, confirmDialog] = useConfirm()` — render `confirmDialog`
 * somewhere in the tree, then `confirm({ title, message, confirmLabel,
 * onConfirm })` opens it. The dialog closes once `onConfirm` resolves.
 */
export function useConfirm() {
  const [request, setRequest] = useState(null);
  const confirm = useCallback(opts => setRequest(opts), []);
  const dialog = request && (
    <ConfirmModal
      {...request}
      onCancel={() => setRequest(null)}
      onConfirm={async () => { await request.onConfirm(); setRequest(null); }}
    />
  );
  return [confirm, dialog];
}
