import { useState, useRef, useEffect, useCallback } from 'react';
import { filesCreateFile, filesUploadBlob, formatBytes, filesGetLimits } from '../../filesApi.js';
import { useFilesAuth, getFilesToken, withFilesToken } from '../../filesAuth.js';
import { IconButton, Select, TextInput } from '../ui/index.js';
import { AttachmentIcon, CloseIcon, WarningIcon } from '../../icons.jsx';
import { isUnlimited } from './utils.js';

const EXPIRY_OPTIONS = [
  { label: '1 hour', value: 1 },
  { label: '24 hours', value: 24 },
  { label: '7 days', value: 7 * 24 },
  { label: '30 days', value: 30 * 24 },
];

const compactControl = { fontSize: '0.8rem', padding: '0.3rem 0.5rem', borderRadius: 4, background: 'var(--bg-secondary)', color: 'var(--text-secondary)' };

/**
 * Whether a file of `size` bytes must have an expiry, given the account's
 * no-expiry size limit (-1 = unlimited, 0/missing = expiry always required).
 */
function isExpirationRequired(size, noExpirySingleFileSize) {
  if (isUnlimited(noExpirySingleFileSize)) return false;
  return !noExpirySingleFileSize || size > noExpirySingleFileSize;
}

function formatMaxExpiry(maxExpiryHours) {
  return `${maxExpiryHours} hours (${Math.round(maxExpiryHours / 24)} days)`;
}

/**
 * File upload item being prepared for upload
 */
function FileUploadItem({ file, expirationHours, onExpirationChange, onRemove, uploading, error, maxExpiryHours, noExpirySingleFileSize }) {
  const [showCustom, setShowCustom] = useState(false);
  const [customHours, setCustomHours] = useState('');

  const expirationRequired = isExpirationRequired(file.size, noExpirySingleFileSize);
  const options = expirationRequired ? EXPIRY_OPTIONS : [{ label: 'Never expires', value: null }, ...EXPIRY_OPTIONS];
  const validOptions = options.filter(opt => opt.value === null || isUnlimited(maxExpiryHours) || opt.value <= maxExpiryHours);

  // Check if custom value exceeds limit (unlimited means no limit)
  const customHoursNum = customHours === '' ? null : parseInt(customHours, 10);
  const customExceedsLimit = customHoursNum !== null && !isNaN(customHoursNum) && !isUnlimited(maxExpiryHours) && customHoursNum > maxExpiryHours;

  // If expiration is required and no default selected, default to 1 hour
  useEffect(() => {
    if (expirationRequired && expirationHours === null) onExpirationChange(1);
  }, [expirationRequired, expirationHours, onExpirationChange]);

  function handleCustomChange(e) {
    const val = e.target.value;
    setCustomHours(val);
    if (val === '') {
      if (!expirationRequired) onExpirationChange(null);
      return;
    }
    const hours = parseInt(val, 10);
    if (isNaN(hours)) return;
    if (hours <= 0) {
      if (!expirationRequired) onExpirationChange(null);
    } else {
      // Values over the limit are stored as-is: the field turns red and send is refused
      onExpirationChange(hours);
    }
  }

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: '0.4rem',
      padding: '0.6rem 0.8rem',
      background: 'var(--bg-input)', borderRadius: 6, border: '1px solid var(--border)',
      fontSize: '0.85rem',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
        <AttachmentIcon size={16} style={{ flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {file.name}
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            {formatBytes(file.size)}
          </div>
          {error && (
            <div style={{ fontSize: '0.75rem', color: 'var(--danger)', marginTop: '0.2rem' }}>{error}</div>
          )}
          {uploading && (
            <div style={{ fontSize: '0.75rem', color: 'var(--accent)', marginTop: '0.2rem' }}>Uploading...</div>
          )}
        </div>
        {!uploading && (
          <IconButton onClick={onRemove} title="Remove file" style={{ flexShrink: 0 }}>
            <CloseIcon size={14} />
          </IconButton>
        )}
      </div>

      {!uploading && (
        <>
          {!showCustom ? (
            <Select
              value={expirationHours ?? ''}
              onChange={(e) => {
                const val = e.target.value;
                if (val === 'custom') setShowCustom(true);
                else onExpirationChange(val === '' ? (expirationRequired ? 1 : null) : parseInt(val, 10));
              }}
              style={compactControl}
            >
              {validOptions.map(opt => (
                <option key={opt.value ?? 'never'} value={opt.value ?? ''}>{opt.label}</option>
              ))}
              <option value="custom">Custom hours...</option>
            </Select>
          ) : (
            <div style={{ display: 'flex', gap: '0.3rem', alignItems: 'center' }}>
              <TextInput
                type="number"
                min="1"
                max={isUnlimited(maxExpiryHours) ? undefined : maxExpiryHours}
                value={customHours}
                onChange={handleCustomChange}
                placeholder={isUnlimited(maxExpiryHours) ? '1+' : `1-${maxExpiryHours}`}
                style={{
                  ...compactControl,
                  flex: 1,
                  ...(customExceedsLimit && { borderColor: 'var(--danger)', color: 'var(--danger)' }),
                }}
              />
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>hrs</span>
              {customExceedsLimit ? (
                <span style={{ fontSize: '0.75rem', color: 'var(--danger)', whiteSpace: 'nowrap' }}>
                  <CloseIcon size={12} /> Too high
                </span>
              ) : (
                <IconButton
                  onClick={() => {
                    setShowCustom(false);
                    setCustomHours('');
                    if (!expirationRequired) onExpirationChange(null);
                  }}
                  title="Cancel custom"
                >
                  <CloseIcon size={14} />
                </IconButton>
              )}
            </div>
          )}
          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
            {expirationRequired ? (
              <>
                <span style={{ color: 'var(--accent)' }}><WarningIcon size={14} /> Expiration required</span>
                {' '}(Max: {isUnlimited(maxExpiryHours) ? '∞' : `${maxExpiryHours} hours / ${Math.round(maxExpiryHours / 24)} days`})
              </>
            ) : (
              <>Max allowed: {isUnlimited(maxExpiryHours) ? 'unlimited' : formatMaxExpiry(maxExpiryHours)}</>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// Why uploads aren't going to the user's Serble Files account, for the hint under the queue.
const GUEST_REASONS = {
  consent_required: 'allow SerbleChat to use Serble Files in Settings › Files to use your account.',
  denied: "Serble Files won't accept SerbleChat right now.",
  reauth_required: 'sign in to SerbleChat again to use your Serble Files account.',
  unavailable: "Serble Files couldn't be connected.",
};

/**
 * File upload panel shown above chat input.
 * Displays queued files (from useFileUploads) waiting to be uploaded on send.
 */
export function FileUploadPanel({ uploads }) {
  const { items, uploading, limits, setFileExpiration, removeFile, filesStatus } = uploads;
  if (items.length === 0) return null;
  const guestReason = GUEST_REASONS[filesStatus];

  return (
    <div style={{
      padding: '0.75rem 0.75rem 0',
      display: 'flex', flexDirection: 'column', gap: '0.5rem',
      borderBottom: '1px solid var(--border)',
      background: 'var(--bg-secondary)',
      borderRadius: '8px 8px 0 0',
    }}>
      <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        <AttachmentIcon size={14} /> {items.length} file{items.length !== 1 ? 's' : ''} attached
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
        {items.map(item => (
          <FileUploadItem
            key={item.id}
            file={item.file}
            expirationHours={item.expirationHours}
            onExpirationChange={hours => setFileExpiration(item.id, hours)}
            onRemove={() => removeFile(item.id)}
            uploading={uploading && !item.error}
            error={item.error}
            maxExpiryHours={limits?.maxExpiryHours || 2592000}
            noExpirySingleFileSize={limits?.noExpirySingleFileSize}
          />
        ))}
      </div>
      {guestReason && (
        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', paddingBottom: '0.5rem' }}>
          Uploading as a guest: {guestReason}
        </div>
      )}
    </div>
  );
}

let nextItemId = 1;

/**
 * Hook to manage file uploads.
 * Each queued file is an item { id, file, expirationHours, error }; the stable
 * id keeps expiry choices and errors attached to the right file when others
 * are removed. `files` / `fileExpirations` are index-aligned views of the queue.
 */
export function useFileUploads() {
  const { token: filesApiToken, status: filesStatus } = useFilesAuth();
  const [items, setItems] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [limits, setLimits] = useState(null); // Account limits
  const fileInputRef = useRef(null);

  // Fetch limits when token changes (works with or without auth — anonymous limits)
  useEffect(() => {
    let cancelled = false;
    // getFilesToken replaces a token that's about to expire; an expired one would quietly get guest limits
    getFilesToken()
      .then(token => filesGetLimits(token))
      .then(data => { if (!cancelled) setLimits(data); })
      .catch(err => console.warn('Failed to fetch file limits:', err));
    return () => { cancelled = true; };
  }, [filesApiToken]);

  const addFiles = useCallback((newFiles) => {
    const added = Array.from(newFiles).map(file => ({ id: nextItemId++, file, expirationHours: null, error: null }));
    // Adding files clears any errors from a previous failed upload
    setItems(prev => [...prev.map(it => ({ ...it, error: null })), ...added]);
  }, []);

  const removeFile = useCallback((id) => {
    setItems(prev => prev.filter(it => it.id !== id));
  }, []);

  const setFileExpiration = useCallback((id, expirationHours) => {
    setItems(prev => prev.map(it => it.id === id ? { ...it, expirationHours } : it));
  }, []);

  const clearFiles = useCallback(() => setItems([]), []);

  /**
   * Upload all files and return array of file IDs
   * Supports both authenticated and anonymous uploads
   * Returns null if no files or if any upload fails (errors are shown per file)
   */
  async function uploadAllFiles() {
    if (items.length === 0) return null;

    setUploading(true);
    const uploadedFileIds = [];
    const errors = {};

    for (const { id, file, expirationHours } of items) {
      try {
        if (isExpirationRequired(file.size, limits?.noExpirySingleFileSize) && expirationHours === null) {
          throw new Error('Expiration time required for this file size');
        }

        if (expirationHours !== null) {
          // Must have limits to set expiration
          if (!limits) throw new Error('Cannot set expiration: limits not loaded');
          if (!Number.isInteger(expirationHours) || expirationHours < 1) {
            throw new Error('Expiration must be at least 1 hour');
          }
          if (!isUnlimited(limits.maxExpiryHours) && expirationHours > limits.maxExpiryHours) {
            throw new Error(`Expiration cannot exceed ${limits.maxExpiryHours} hours (max allowed: ${Math.round(limits.maxExpiryHours / 24)} days)`);
          }
        }

        // Create file metadata on Files API (token can be null for anonymous uploads)
        const createResponse = await withFilesToken(token => filesCreateFile(file.name, file.size, expirationHours, token));
        if (!createResponse.file || !createResponse.file.id) {
          throw new Error('No file ID in response');
        }

        await filesUploadBlob(createResponse.uploadUrl, createResponse.uploadFields, file, file.name);
        uploadedFileIds.push(createResponse.file.id);
      } catch (err) {
        errors[id] = err.message || 'Upload failed';
      }
    }

    setUploading(false);

    // Only return IDs if all uploads succeeded
    if (Object.keys(errors).length === 0) {
      clearFiles();
      return uploadedFileIds;
    }

    // If some failed, return null and keep showing errors
    setItems(prev => prev.map(it => ({ ...it, error: errors[it.id] ?? null })));
    return null;
  }

  return {
    items,
    files: items.map(it => it.file),
    fileExpirations: items.map(it => it.expirationHours),
    addFiles,
    removeFile,
    setFileExpiration,
    clearFiles,
    uploading,
    uploadAllFiles,
    fileInputRef,
    limits,
    filesStatus,
  };
}
