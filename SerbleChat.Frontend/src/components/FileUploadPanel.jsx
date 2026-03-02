import React, { useState, useRef, useEffect } from 'react';
import { useClientOptions } from '../context/ClientOptionsContext.jsx';
import { filesCreateFile, filesUploadBlob, formatBytes, filesGetLimits } from '../filesApi.js';

/**
 * File upload item being prepared for upload
 */
function FileUploadItem({ file, expirationHours, onExpirationChange, onRemove, uploading, error, maxExpiryHours, noExpirySingleFileSize }) {
  const [showCustom, setShowCustom] = useState(false);
  const [customHours, setCustomHours] = useState('');

  // Determine if expiration is required (when noExpirySingleFileSize is 0 or file exceeds it)
  const expirationRequired = !noExpirySingleFileSize || noExpirySingleFileSize === 0 || file.size > noExpirySingleFileSize;

  const expirationOptions = expirationRequired
    ? [
        { label: '1 hour', value: 1 },
        { label: '24 hours', value: 24 },
        { label: '7 days', value: 7 * 24 },
        { label: '30 days', value: 30 * 24 },
      ]
    : [
        { label: 'Never expires', value: null },
        { label: '1 hour', value: 1 },
        { label: '24 hours', value: 24 },
        { label: '7 days', value: 7 * 24 },
        { label: '30 days', value: 30 * 24 },
      ];

  const validOptions = expirationOptions.filter(opt => opt.value === null || opt.value <= maxExpiryHours);

  // Check if custom value exceeds limit
  const customHoursNum = customHours === '' ? null : parseInt(customHours);
  const customExceedsLimit = customHoursNum !== null && !isNaN(customHoursNum) && customHoursNum > maxExpiryHours;

  // If expiration is required and no default selected, default to 1 hour
  useEffect(() => {
    if (expirationRequired && expirationHours === null) {
      onExpirationChange(1);
    }
  }, [expirationRequired, expirationHours, onExpirationChange]);

  function handleCustomChange(e) {
    const val = e.target.value;
    setCustomHours(val);
    
    if (val === '') {
      if (!expirationRequired) {
        onExpirationChange(null);
      }
      return;
    }

    const hours = parseInt(val);
    if (!isNaN(hours)) {
      if (hours <= 0) {
        if (!expirationRequired) {
          onExpirationChange(null);
        }
      } else if (hours > maxExpiryHours) {
        // Don't auto-clamp anymore, just leave the value
        // User will see red field and error on send
        onExpirationChange(hours); // Store the invalid value so it shows in UI
      } else {
        onExpirationChange(hours);
      }
    }
  }

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      gap: '0.4rem',
      padding: '0.6rem 0.8rem',
      background: 'var(--bg-input)',
      borderRadius: 6,
      border: '1px solid var(--border)',
      fontSize: '0.85rem',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
        <span style={{ fontSize: '1rem', flexShrink: 0 }}>📎</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {file.name}
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            {formatBytes(file.size)}
          </div>
          {error && (
            <div style={{ fontSize: '0.75rem', color: 'var(--danger)', marginTop: '0.2rem' }}>
              {error}
            </div>
          )}
          {uploading && (
            <div style={{ fontSize: '0.75rem', color: 'var(--accent)', marginTop: '0.2rem' }}>
              Uploading...
            </div>
          )}
        </div>
        {!uploading && (
          <button
            onClick={onRemove}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--text-muted)',
              cursor: 'pointer',
              padding: '0.2rem 0.4rem',
              fontSize: '1rem',
              lineHeight: 1,
              flexShrink: 0,
            }}
            title="Remove file"
          >
            ✕
          </button>
        )}
      </div>

      {!uploading && (
        <>
          {!showCustom ? (
            <div style={{ display: 'flex', gap: '0.3rem' }}>
              <select
                value={expirationHours ?? ''}
                onChange={(e) => {
                  const val = e.target.value;
                  if (val === 'custom') {
                    setShowCustom(true);
                  } else {
                    onExpirationChange(val === '' ? (expirationRequired ? 1 : null) : parseInt(val));
                  }
                }}
                style={{
                  flex: 1,
                  background: 'var(--bg-secondary)',
                  border: '1px solid var(--border)',
                  borderRadius: 4,
                  color: 'var(--text-secondary)',
                  fontSize: '0.8rem',
                  padding: '0.3rem 0.5rem',
                  cursor: 'pointer',
                }}
              >
                {validOptions.map(opt => (
                  <option key={opt.value ?? 'never'} value={opt.value ?? ''}>
                    {opt.label}
                  </option>
                ))}
                <option value="custom">Custom hours...</option>
              </select>
            </div>
          ) : (
            <div style={{ display: 'flex', gap: '0.3rem', alignItems: 'center' }}>
              <input
                type="number"
                min="1"
                max={maxExpiryHours}
                value={customHours}
                onChange={handleCustomChange}
                placeholder={`1-${maxExpiryHours}`}
                style={{
                  flex: 1,
                  background: 'var(--bg-secondary)',
                  border: customExceedsLimit ? '1px solid #f23f43' : '1px solid var(--border)',
                  borderRadius: 4,
                  color: customExceedsLimit ? '#f23f43' : 'var(--text-secondary)',
                  fontSize: '0.8rem',
                  padding: '0.3rem 0.5rem',
                  width: '100%',
                }}
              />
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                hrs
              </span>
              {customExceedsLimit && (
                <span style={{ fontSize: '0.75rem', color: '#f23f43', whiteSpace: 'nowrap' }}>
                  ✕ Too high
                </span>
              )}
              {!customExceedsLimit && (
                <button
                  onClick={() => {
                    setShowCustom(false);
                    setCustomHours('');
                    if (!expirationRequired) {
                      onExpirationChange(null);
                    }
                  }}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'var(--text-muted)',
                    cursor: 'pointer',
                    padding: '0.2rem 0.4rem',
                    fontSize: '0.85rem',
                    lineHeight: 1,
                  }}
                  title="Cancel custom"
                >
                  ✕
                </button>
              )}
            </div>
          )}
          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
            {expirationRequired ? (
              <>
                <span style={{ color: 'var(--accent)' }}>⚠ Expiration required</span>
                {' '}(Max: {maxExpiryHours} hours / {Math.round(maxExpiryHours / 24)} days)
              </>
            ) : (
              <>Max allowed: {maxExpiryHours} hours ({Math.round(maxExpiryHours / 24)} days)</>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/**
 * File upload panel shown above chat input
 * Displays queued files waiting to be uploaded when user clicks send
 */
export function FileUploadPanel({ files, fileExpirations, onFileExpirationChange, onRemoveFile, uploading, errors, maxExpiryHours, noExpirySingleFileSize }) {
  if (!files || files.length === 0) {
    return null;
  }

  return (
    <div style={{
      padding: '0.75rem 0.75rem 0',
      display: 'flex',
      flexDirection: 'column',
      gap: '0.5rem',
      borderBottom: '1px solid var(--border)',
      background: 'var(--bg-secondary)',
      borderRadius: '8px 8px 0 0',
    }}>
      <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        📎 {files.length} file{files.length !== 1 ? 's' : ''} attached
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
        {files.map((file, idx) => (
          <FileUploadItem
            key={idx}
            file={file}
            expirationHours={fileExpirations?.[idx] ?? null}
            onExpirationChange={(expHours) => onFileExpirationChange(idx, expHours)}
            onRemove={() => onRemoveFile(idx)}
            uploading={uploading && errors[idx] === undefined}
            error={errors[idx]}
            maxExpiryHours={maxExpiryHours || 2592000}
            noExpirySingleFileSize={noExpirySingleFileSize}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * Hook to manage file uploads
 * Returns an object with file state, handlers, and an async upload function
 */
export function useFileUploads() {
  const { filesApiToken } = useClientOptions();
  const [files, setFiles] = useState([]); // Array of File objects
  const [fileExpirations, setFileExpirations] = useState({}); // { [index]: expirationHours }
  const [uploadErrors, setUploadErrors] = useState({}); // { [index]: error message }
  const [uploading, setUploading] = useState(false);
  const [limits, setLimits] = useState(null); // Account limits
  const fileInputRef = useRef(null);

  // Fetch limits when token changes
  useEffect(() => {
    if (!filesApiToken) {
      setLimits(null);
      return;
    }

    filesGetLimits(filesApiToken).then(limitsData => {
      setLimits(limitsData);
    }).catch(err => {
      console.warn('Failed to fetch file limits:', err);
    });
  }, [filesApiToken]);

  function addFiles(newFiles) {
    const newFileArray = Array.from(newFiles);
    setFiles(prev => [...prev, ...newFileArray]);
    // Initialize expiration for new files (default to no expiration)
    setFileExpirations(prev => ({
      ...prev,
      ...Object.fromEntries(newFileArray.map((_, i) => [
        prev ? Object.keys(prev).length + i : i,
        null
      ]))
    }));
    setUploadErrors({});
  }

  function removeFile(index) {
    setFiles(prev => prev.filter((_, i) => i !== index));
    const newExpirations = { ...fileExpirations };
    delete newExpirations[index];
    setFileExpirations(newExpirations);
    const newErrors = { ...uploadErrors };
    delete newErrors[index];
    setUploadErrors(newErrors);
  }

  function setFileExpiration(index, expirationHours) {
    setFileExpirations(prev => ({
      ...prev,
      [index]: expirationHours
    }));
  }

  function clearFiles() {
    setFiles([]);
    setFileExpirations({});
    setUploadErrors({});
  }

  /**
   * Upload all files and return array of file IDs
   * Supports both authenticated and anonymous uploads
   * Returns null if no files or if upload fails
   */
  async function uploadAllFiles() {
    if (files.length === 0) {
      return null;
    }

    setUploading(true);
    const uploadedFileIds = [];
    const errors = {};

    for (let i = 0; i < files.length; i++) {
      try {
        const file = files[i];
        const expirationHours = fileExpirations[i];
        
        // Check if expiration is required for this file
        const expirationRequired = !limits?.noExpirySingleFileSize || limits.noExpirySingleFileSize === 0 || file.size > limits.noExpirySingleFileSize;

        // Validate expiration is set when required
        if (expirationRequired && expirationHours === null) {
          throw new Error('Expiration time required for this file size');
        }

        // Validate expiration hours against limits
        if (expirationHours !== null) {
          // Must have limits to set expiration
          if (!limits) {
            throw new Error('Cannot set expiration: limits not loaded');
          }

          // Validate the value is a positive integer
          if (!Number.isInteger(expirationHours) || expirationHours < 1) {
            throw new Error('Expiration must be at least 1 hour');
          }

          // Enforce max expiration
          if (expirationHours > limits.maxExpiryHours) {
            throw new Error(`Expiration cannot exceed ${limits.maxExpiryHours} hours (max allowed: ${Math.round(limits.maxExpiryHours / 24)} days)`);
          }
        }

        // Create file metadata on Files API (works with or without token)
        const createResponse = await filesCreateFile(
          file.name,
          file.size,
          expirationHours, // can be null for no expiration
          filesApiToken // can be null for anonymous uploads
        );

        if (!createResponse.file || !createResponse.file.id) {
          throw new Error('No file ID in response');
        }

        // Upload the actual file blob
        await filesUploadBlob(
          createResponse.uploadUrl,
          createResponse.uploadFields,
          file,
          file.name
        );

        uploadedFileIds.push(createResponse.file.id);
      } catch (err) {
        errors[i] = err.message || 'Upload failed';
      }
    }

    setUploading(false);
    setUploadErrors(errors);

    // Only return IDs if all uploads succeeded
    if (Object.keys(errors).length === 0) {
      clearFiles();
      return uploadedFileIds;
    }

    // If some failed, return null and keep showing errors
    return null;
  }

  return {
    files,
    fileExpirations,
    addFiles,
    removeFile,
    setFileExpiration,
    clearFiles,
    uploading,
    uploadErrors,
    uploadAllFiles,
    fileInputRef,
    limits,
  };
}
