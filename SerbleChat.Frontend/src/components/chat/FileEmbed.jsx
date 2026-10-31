import { useState, useEffect } from 'react';
import ImageModal from './ImageModal.jsx';
import { triggerDownload } from '../../electron-utils.js';
import { Button } from '../ui/index.js';
import { XCircleIcon, ImageIcon, DocumentIcon, DownloadIcon } from '../../icons.jsx';
import './chat.css';

/**
 * Image extensions that we can render directly
 */
const IMAGE_EXTENSIONS = new Set([
  'jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg',
]);

function getPathname(url) {
  try { return new URL(url).pathname; } catch { return ''; }
}

/**
 * Extract file extension from a URL
 */
function getFileExtension(url) {
  const pathname = getPathname(url);
  const lastDot = pathname.lastIndexOf('.');
  if (lastDot === -1) return '';
  return pathname.slice(lastDot + 1).toLowerCase();
}

/**
 * Get a human-readable file size
 */
function formatFileSize(bytes) {
  if (typeof bytes !== 'number' || bytes < 0) return 'Unknown';
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const size = (bytes / Math.pow(1024, index)).toFixed(1);
  return `${size} ${units[index]}`;
}

/**
 * Get the filename from a URL path
 */
function getFilename(url) {
  return getPathname(url).split('/').pop() || 'File';
}

/**
 * Extract filename from Content-Disposition header
 */
function getFilenameFromHeader(header) {
  if (!header) return null;
  // Handle RFC 5987 format: filename*=UTF-8''encoded
  const utf8Match = header.match(/filename\*=(?:UTF-8)?'*'?([^;]+)/);
  if (utf8Match) {
    try {
      return decodeURIComponent(utf8Match[1]);
    } catch {
      // Fallback to basic filename if decoding fails
    }
  }
  // Handle standard format: filename="name" or filename=name
  const basicMatch = header.match(/filename=(?:"([^"]+)"|([^;,\s]+))/);
  if (basicMatch) {
    return basicMatch[1] || basicMatch[2];
  }
  return null;
}

/** Card layout shared by every non-inline file state: icon, label, name, optional size and action. */
function FileCard({ icon, label, title, subtitle, action }) {
  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: '0.75rem',
      background: 'var(--bg-secondary)', border: '1px solid var(--border)',
      borderRadius: '8px', padding: '0.75rem 1rem',
      marginTop: '0.35rem', maxWidth: 380,
    }}>
      <div style={{
        width: 40, height: 40, borderRadius: '6px', flexShrink: 0,
        background: 'var(--bg-tertiary)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        {icon}
      </div>
      <div style={{ flex: 1, overflow: 'hidden', minWidth: 0 }}>
        <div style={{
          fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 700,
          textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.1rem',
        }}>
          {label}
        </div>
        <div style={{
          fontSize: '0.88rem', color: 'var(--text-primary)', fontWeight: 500,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {title}
        </div>
        {subtitle && (
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.15rem' }}>{subtitle}</div>
        )}
      </div>
      {action}
    </div>
  );
}

/**
 * A card shown when a files API URL appears in a message.
 * If the file is an image, renders it (click to open the fullscreen viewer).
 * Otherwise, shows a download card.
 * Props: fileUrl (string) - the full URL to the file,
 *        onImageContextMenu (func) - context menu handler for the embedded image,
 *        onModalImageContextMenu (func) - context menu handler for the fullscreen viewer
 */
export default function FileEmbed({ fileUrl, onImageContextMenu, onModalImageContextMenu }) {
  const [imageError, setImageError] = useState(false);
  const [imageLoading, setImageLoading] = useState(true);
  const [fileSize, setFileSize] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [displayFilename, setDisplayFilename] = useState(null);

  const isImage = IMAGE_EXTENSIONS.has(getFileExtension(fileUrl));
  const filename = displayFilename || getFilename(fileUrl);

  // Fetch file metadata: the real filename (Content-Disposition) and, for non-images, the size
  useEffect(() => {
    let cancelled = false;

    function readHeaders(res) {
      const headerFilename = getFilenameFromHeader(res.headers.get('content-disposition'));
      if (headerFilename) setDisplayFilename(headerFilename);
      if (!isImage) {
        const contentLength = res.headers.get('content-length');
        if (contentLength) setFileSize(parseInt(contentLength, 10));
      }
    }

    fetch(fileUrl, { method: 'HEAD' })
      .then(res => {
        if (cancelled) return;
        if (!res.ok) { setNotFound(true); return; }
        readHeaders(res);
      })
      .catch(() => {
        if (cancelled || isImage) return;
        // If HEAD fails, try GET with range
        fetch(fileUrl, { headers: { 'Range': 'bytes=0-0' } })
          .then(res => {
            if (cancelled) return;
            if (!res.ok) { setNotFound(true); return; }
            readHeaders(res);
          })
          .catch(() => {
            // Silently fail, we'll just show the file without size info
          });
      });

    return () => { cancelled = true; };
  }, [fileUrl, isImage]);

  const downloadButton = (
    <Button variant="primary" size="sm" title="Download file" onClick={() => triggerDownload(fileUrl, filename)} style={{ flexShrink: 0 }}>
      Download
    </Button>
  );

  if (notFound) {
    return (
      <FileCard
        icon={<XCircleIcon size={20} />}
        label={isImage ? 'Image' : 'File'}
        title={isImage ? 'This image does not exist' : 'This file does not exist'}
      />
    );
  }

  // Image failed to load for some other reason - show as a downloadable file
  if (isImage && imageError) {
    return <FileCard icon={<ImageIcon size={32} />} label="Image" title={filename} action={downloadButton} />;
  }

  if (isImage) {
    return (
      <>
        <div className="chat-image-embed" onClick={() => setShowModal(true)}>
          <img
            src={fileUrl}
            alt="Embedded image"
            onError={() => setImageError(true)}
            onLoad={() => setImageLoading(false)}
            onContextMenu={(e) => {
              e.stopPropagation();
              onImageContextMenu?.(e);
            }}
            style={{
              width: '100%', display: 'block',
              maxHeight: 500, objectFit: 'cover',
              opacity: imageLoading ? 0.6 : 1,
              transition: 'opacity 0.2s',
            }}
          />
          <button
            className="chat-overlay-btn"
            onClick={e => {
              e.stopPropagation();
              triggerDownload(fileUrl, filename);
            }}
            title="Download image"
            style={{ position: 'absolute', top: '0.5rem', right: '0.5rem', borderRadius: '6px', padding: '0.4rem 0.6rem' }}
          >
            <DownloadIcon size={14} />
          </button>
        </div>
        <ImageModal
          isOpen={showModal}
          imageUrl={fileUrl}
          onClose={() => setShowModal(false)}
          filename={filename}
          onContextMenu={onModalImageContextMenu}
        />
      </>
    );
  }

  return (
    <FileCard
      icon={<DocumentIcon size={32} />}
      label="File"
      title={filename}
      subtitle={fileSize != null ? formatFileSize(fileSize) : null}
      action={downloadButton}
    />
  );
}
