import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useMobile } from '../context/MobileContext.jsx';
import { updateGuildChannel, deleteGuildChannel, uploadChannelIcon, deleteChannelIcon, getChannelIconUrl } from '../api.js';

const labelStyle = {
  display: 'block', fontSize: '0.72rem', fontWeight: 700,
  color: 'var(--text-muted)', textTransform: 'uppercase',
  letterSpacing: '0.07em', marginBottom: '0.4rem',
};

const inputStyle = {
  width: '100%', background: 'var(--bg-tertiary)', border: '1px solid var(--border)',
  borderRadius: '6px', padding: '0.65rem 0.75rem', color: 'var(--text-primary)',
  fontSize: '0.9rem', outline: 'none', transition: 'border-color 0.15s',
  boxSizing: 'border-box',
};

export default function ChannelSettingsModal({ guildId, channel, canManage, onClose, onUpdated, onDeleted, channelUpdatedEvent }) {
  const { isMobile } = useMobile();
  const [name, setName] = useState(channel?.name ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
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

  // Check if channel icon exists when modal opens
  useEffect(() => {
    const img = new Image();
    img.onload = () => setHasIcon(true);
    img.onerror = () => setHasIcon(false);
    img.src = getChannelIconUrl(guildId, channel.id);
  }, [channel.id, guildId]);

  // Refresh icon preview when channel is updated
  useEffect(() => {
    if (!channelUpdatedEvent) return;
    if (String(channelUpdatedEvent.channelId) === String(channel.id)) {
      const img = new Image();
      img.onload = () => setHasIcon(true);
      img.onerror = () => setHasIcon(false);
      img.src = getChannelIconUrl(guildId, channel.id) + '?t=' + channelUpdatedEvent.ts;
    }
  }, [channelUpdatedEvent, channel.id, guildId]);

  async function handleSave(e) {
    e.preventDefault();
    if (!name.trim() || name.trim() === channel.name) { onClose(); return; }
    setBusy(true);
    setError(null);
    try {
      await updateGuildChannel(guildId, channel.id, { name: name.trim() });
      onUpdated({ ...channel, name: name.trim() });
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (!confirm(`Delete "#${channel.name}"? This cannot be undone.`)) return;
    setBusy(true);
    try {
      await deleteGuildChannel(guildId, channel.id);
      onDeleted();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  async function handleIconUpload(file) {
    if (!file) return;
    setUploadingIcon(true);
    setIconError(null);
    try {
      await uploadChannelIcon(guildId, channel.id, file);
      setError(null);
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
      await deleteChannelIcon(guildId, channel.id);
      setError(null);
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
        width: '100%', maxWidth: isMobile ? '100%' : 460,
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
            Channel Settings
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
          <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {/* Channel Name */}
            <div>
              <label style={labelStyle}>Channel Name</label>
              <input autoFocus value={name} onChange={e => setName(e.target.value)} maxLength={64}
                style={inputStyle}
                onFocus={e => e.target.style.borderColor = 'var(--accent)'}
                onBlur={e => e.target.style.borderColor = 'var(--border)'} />
            </div>

            {/* Channel Icon Upload */}
            {canManage && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                <label style={labelStyle}>Channel Icon</label>
                <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-start' }}>
                  <div style={{
                    width: 64, height: 64, borderRadius: '8px',
                    background: 'var(--bg-secondary)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: '2rem', overflow: 'hidden', flexShrink: 0,
                    border: '1px solid var(--border)',
                  }}>
                    {hasIcon ? (
                      <img
                        key={`channel-icon-${channel.id}-${channelUpdatedEvent?.ts || 0}`}
                        src={getChannelIconUrl(guildId, channel.id) + (channelUpdatedEvent?.ts ? '?t=' + channelUpdatedEvent.ts : '')}
                        alt="Channel icon"
                        onError={() => setHasIcon(false)}
                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                      />
                    ) : (
                      '#'
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
            )}

            {error && (
              <div style={{
                background: 'rgba(242,63,67,0.1)', border: '1px solid rgba(242,63,67,0.3)',
                borderRadius: '6px', padding: '0.5rem 0.75rem', color: 'var(--danger)',
                fontSize: '0.83rem',
              }}>
                {error}
              </div>
            )}

            <button type="submit" disabled={busy || !name.trim()}
              style={{
                background: 'var(--accent)', border: 'none', borderRadius: '6px',
                padding: '0.65rem', color: '#fff', fontSize: '0.9rem', fontWeight: 600,
                cursor: busy || !name.trim() ? 'default' : 'pointer',
                opacity: busy || !name.trim() ? 0.6 : 1, transition: 'background 0.15s',
              }}
              className={!busy && name.trim() ? 'hov-accent' : undefined}>
              Save Changes
            </button>

            {canManage && (
              <div style={{
                borderTop: '1px solid var(--border)', paddingTop: '1rem',
                display: 'flex', flexDirection: 'column', gap: '0.5rem',
              }}>
                <div style={{
                  fontSize: '0.72rem', fontWeight: 700, color: 'var(--danger)',
                  textTransform: 'uppercase', letterSpacing: '0.07em',
                }}>
                  Danger Zone
                </div>
                <button type="button" onClick={handleDelete} disabled={busy}
                  style={{
                    background: 'transparent', border: '1px solid var(--danger)',
                    borderRadius: '6px', padding: '0.5rem 1rem', color: 'var(--danger)',
                    fontSize: '0.875rem', fontWeight: 600, cursor: busy ? 'default' : 'pointer',
                    alignSelf: 'flex-start', transition: 'background 0.15s, color 0.15s',
                  }}
                  className={!busy ? 'hov-danger-fill' : undefined}>
                  Delete Channel
                </button>
              </div>
            )}
          </form>
        </div>
      </div>
    </div>,
    document.body
  );
}
