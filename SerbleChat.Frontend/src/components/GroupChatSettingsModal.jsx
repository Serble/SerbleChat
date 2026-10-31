import { useState, useRef } from 'react';
import { uploadGroupChatIcon, deleteGroupChatIcon } from '../api.js';
import { PeopleIcon } from '../icons.jsx';
import { Modal, Button, ErrorBox } from './ui/index.js';
import { FieldLabel } from './ui/index.js';
import useGroupChatIcon from './useGroupChatIcon.js';

export default function GroupChatSettingsModal({ chat, onClose, channelUpdatedEvent }) {
  const [uploadingIcon, setUploadingIcon] = useState(false);
  const [iconError, setIconError] = useState(null);
  const iconFileRef = useRef(null);
  const icon = useGroupChatIcon(chat.channelId, channelUpdatedEvent);

  // Upload / delete; the ChannelUpdated signal refreshes the icon preview afterwards.
  async function runIconAction(action) {
    setUploadingIcon(true);
    setIconError(null);
    try {
      await action();
    } catch (err) {
      setIconError(err.message);
    } finally {
      setUploadingIcon(false);
    }
  }

  return (
    <Modal onClose={onClose} title="Group Chat Icon" width={400} style={{ maxHeight: '90vh' }}>
      <div style={{
        overflowY: 'auto', flex: 1, padding: '1.25rem 1.5rem',
        display: 'flex', flexDirection: 'column', gap: '1rem',
      }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          <FieldLabel style={{ marginBottom: 0 }}>Group Chat Icon</FieldLabel>
          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-start' }}>
            <div style={{
              width: 80, height: 80, borderRadius: '8px',
              background: 'var(--bg-secondary)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              overflow: 'hidden', flexShrink: 0,
              border: '1px solid var(--border)',
              color: 'var(--text-muted)',
            }}>
              {icon.hasIcon ? (
                <img
                  src={icon.src}
                  alt="Group chat icon"
                  onError={icon.onError}
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                />
              ) : (
                <PeopleIcon size={40} />
              )}
            </div>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <input
                ref={iconFileRef}
                type="file"
                accept="image/*"
                style={{ display: 'none' }}
                onChange={e => {
                  const file = e.target.files?.[0];
                  if (file) runIconAction(() => uploadGroupChatIcon(chat.channelId, file));
                  e.target.value = '';
                }}
              />
              <Button onClick={() => iconFileRef.current?.click()} disabled={uploadingIcon}>
                {uploadingIcon ? 'Uploading…' : 'Upload Image'}
              </Button>
              {icon.hasIcon && (
                <Button
                  variant="danger"
                  onClick={() => runIconAction(() => deleteGroupChatIcon(chat.channelId))}
                  disabled={uploadingIcon}
                >
                  Remove Icon
                </Button>
              )}
            </div>
          </div>
          <ErrorBox>{iconError}</ErrorBox>
        </div>

        <Button variant="primary" onClick={onClose} style={{ padding: '0.65rem', fontSize: '0.9rem' }}>
          Done
        </Button>
      </div>
    </Modal>
  );
}
