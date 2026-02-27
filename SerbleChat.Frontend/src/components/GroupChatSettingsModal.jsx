import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useMobile } from '../context/MobileContext.jsx';
import { uploadGroupChatIcon, deleteGroupChatIcon, getGroupChatIconUrl } from '../api.js';

const labelStyle = {
  display: 'block', fontSize: '0.72rem', fontWeight: 700,
  color: 'var(--text-muted)', textTransform: 'uppercase',
  letterSpacing: '0.07em', marginBottom: '0.4rem',
};

export default function GroupChatSettingsModal({ chat, onClose, channelUpdatedEvent }) {
  const { isMobile } = useMobile();
  const [uploadingIcon, setUploadingIcon] = useState(false);
  const [iconError, setIconError] = useState(null);
  const [hasIcon, setHasIcon] = useState(false);
  const iconFileRef = useRef(null);
  const backdropRef = useRef(null);

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Check if group chat icon exists when modal opens
  useEffect(() => {
    const img = new Image();
    img.onload = () => setHasIcon(true);
    img.onerror = () => setHasIcon(false);
    img.src = getGroupChatIconUrl(chat.channelId);
  }, [chat.channelId]);

  // Refresh icon preview when channel is updated
  useEffect(() => {
    if (!channelUpdatedEvent) return;
    if (String(channelUpdatedEvent.channelId) === String(chat.channelId)) {
      const img = new Image();
      img.onload = () => setHasIcon(true);
      img.onerror = () => setHasIcon(false);
      img.src = getGroupChatIconUrl(chat.channelId) + '?t=' + channelUpdatedEvent.ts;
    }
  }, [channelUpdatedEvent, chat.channelId]);

  async function handleIconUpload(file) {
    if (!file) return;
    setUploadingIcon(true);
    setIconError(null);
    try {
      await uploadGroupChatIcon(chat.channelId, file);
      // ChannelUpdated signal will handle refreshing the icon
    } catch (err) {
      setIconError(err.message);
    } finally {
      setUploadingIcon(false);
    }
  }

  async function handleIconDelete() {
    setUploadingIcon(true);
    setIconError(null);
    try {
      await deleteGroupChatIcon(chat.channelId);
      // ChannelUpdated signal will handle refreshing the icon
    } catch (err) {
      setIconError(err.message);
    } finally {
      setUploadingIcon(false);
    }
  }

  return createPortal(
    <div
      ref={backdropRef}
      onClick={e => { if (e.target === backdropRef.current) onClose(); }}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.75)',
        display: 'flex', alignItems: isMobile ? 'stretch' : 'center',
        justifyContent: isMobile ? 'stretch' : 'center', padding: isMobile ? 0 : '1rem',
      }}
    >
      <div style={{
        background: 'var(--bg-base)', borderRadius: isMobile ? 0 : '12px',
        width: '100%', maxWidth: isMobile ? '100%' : 400,
        boxShadow: '0 16px 48px rgba(0,0,0,0.6)', overflow: 'hidden',
        height: isMobile ? '100%' : 'auto', maxHeight: isMobile ? '100%' : '90vh',
        display: 'flex', flexDirection: 'column', transition: 'max-width 0.15s',
      }}>
        {/* Header */}
        <div style={{
          padding: '1.25rem 1.5rem 0', display: 'flex', alignItems: 'center',
          justifyContent: 'space-between', flexShrink: 0,
        }}>
          <div style={{ fontWeight: 800, fontSize: '1.1rem', color: 'var(--text-primary)' }}>
            Group Chat Icon
          </div>
          <button onClick={onClose}
            style={{
              background: 'transparent', border: 'none', color: 'var(--text-muted)',
              fontSize: '1.25rem', cursor: 'pointer', lineHeight: 1, padding: '0.2rem',
              borderRadius: '4px', transition: 'color 0.15s',
            }}
            className="hov-text-primary">✕</button>
        </div>

        {/* Content */}
        <div style={{
          overflowY: 'auto', flex: 1, padding: '1.25rem 1.5rem',
          display: 'flex', flexDirection: 'column', gap: '1rem',
        }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <label style={labelStyle}>Group Chat Icon</label>
            <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-start' }}>
              <div style={{
                width: 80, height: 80, borderRadius: '8px',
                background: 'var(--bg-secondary)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '2.5rem', overflow: 'hidden', flexShrink: 0,
                border: '1px solid var(--border)',
              }}>
                {hasIcon ? (
                  <img
                    key={`group-icon-modal-${chat.channelId}-${channelUpdatedEvent?.ts || 0}`}
                    src={getGroupChatIconUrl(chat.channelId) + (channelUpdatedEvent?.ts ? '?t=' + channelUpdatedEvent.ts : '')}
                    alt="Group chat icon"
                    onError={() => setHasIcon(false)}
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                  />
                ) : (
                  '👥'
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
                    if (file) handleIconUpload(file);
                    if (e.target) e.target.value = '';
                  }}
                />
                <button
                  type="button"
                  onClick={() => iconFileRef.current?.click()}
                  disabled={uploadingIcon}
                  style={{
                    background: 'var(--bg-active)',
                    border: '1px solid var(--border)',
                    borderRadius: '6px',
                    padding: '0.45rem 0.75rem',
                    color: 'var(--text-secondary)',
                    fontSize: '0.875rem',
                    fontWeight: 600,
                    cursor: uploadingIcon ? 'default' : 'pointer',
                    opacity: uploadingIcon ? 0.6 : 1,
                    transition: 'background 0.15s, color 0.15s',
                  }}
                  className={!uploadingIcon ? 'hov-bg' : undefined}
                >
                  {uploadingIcon ? 'Uploading…' : 'Upload Image'}
                </button>
                {hasIcon && (
                  <button
                    type="button"
                    onClick={handleIconDelete}
                    disabled={uploadingIcon}
                    style={{
                      background: 'transparent',
                      border: '1px solid var(--border)',
                      borderRadius: '6px',
                      padding: '0.45rem 0.75rem',
                      color: 'var(--danger)',
                      fontSize: '0.875rem',
                      fontWeight: 600,
                      cursor: uploadingIcon ? 'default' : 'pointer',
                      opacity: uploadingIcon ? 0.6 : 1,
                      transition: 'background 0.15s, color 0.15s',
                    }}
                    className={!uploadingIcon ? 'hov-danger-fill' : undefined}
                  >
                    Remove Icon
                  </button>
                )}
              </div>
            </div>
            {iconError && (
              <div style={{
                background: 'rgba(242,63,67,0.1)',
                border: '1px solid rgba(242,63,67,0.3)',
                borderRadius: '6px',
                padding: '0.5rem 0.75rem',
                color: 'var(--danger)',
                fontSize: '0.83rem',
              }}>
                {iconError}
              </div>
            )}
          </div>

          <button
            onClick={onClose}
            style={{
              background: 'var(--accent)', border: 'none', borderRadius: '6px',
              padding: '0.65rem', color: '#fff', fontSize: '0.9rem', fontWeight: 600,
              cursor: 'pointer', transition: 'background 0.15s',
            }}
            className="hov-accent"
          >
            Done
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
