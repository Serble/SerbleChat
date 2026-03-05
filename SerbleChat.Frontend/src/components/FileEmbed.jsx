import { useState, useEffect } from 'react';
import ImageModal from './ImageModal.jsx';
import { triggerDownload } from '../electron-utils.js';

/**
 * Image extensions that we can render directly
 */
const IMAGE_EXTENSIONS = new Set([
  'jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg',
]);

/**
 * Extract file extension from a URL
 */
function getFileExtension(url) {
  if (!url) return '';
  const pathname = new URL(url).pathname;
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
  const index = Math.floor(Math.log(bytes) / Math.log(1024));
  const size = (bytes / Math.pow(1024, index)).toFixed(1);
  return `${size} ${units[index]}`;
}

/**
 * Get the filename from a URL path
 */
function getFilename(url) {
  if (!url) return 'File';
  try {
    const pathname = new URL(url).pathname;
    const filename = pathname.split('/').pop();
    return filename || 'File';
  } catch {
    return 'File';
  }
}

/**
 * A card shown when a files API URL appears in a message.
 * If the file is an image, renders it. Otherwise, shows a download button.
 * Props: fileUrl (string) - the full URL to the file, onImageContextMenu (func) - context menu handler for embedded image, onModalImageContextMenu (func) - context menu handler for modal
 */
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

export default function FileEmbed({ fileUrl, onImageContextMenu, onModalImageContextMenu }) {
  const [imageError, setImageError] = useState(false);
  const [imageLoading, setImageLoading] = useState(true);
  const [fileMeta, setFileMeta] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [fileNotFound, setFileNotFound] = useState(false);
  const [displayFilename, setDisplayFilename] = useState(null);
  const [imageNotFound, setImageNotFound] = useState(false);

  const extension = getFileExtension(fileUrl);
  const isImage = IMAGE_EXTENSIONS.has(extension);
  const filename = displayFilename || getFilename(fileUrl);

  // Try to fetch file metadata (size, etc.) and extract actual filename
  useEffect(() => {
    fetch(fileUrl, { method: 'HEAD' })
      .then(res => {
        if (!res.ok) {
          // Handle 404 and other error statuses
          if (!isImage) {
            setFileNotFound(true);
          } else {
            setImageNotFound(true);
          }
          return;
        }
        // Extract filename from Content-Disposition header
        const disposition = res.headers.get('content-disposition');
        const headerFilename = getFilenameFromHeader(disposition);
        if (headerFilename) {
          setDisplayFilename(headerFilename);
        }
        
        // For non-image files, also get the content-length
        if (!isImage) {
          const contentLength = res.headers.get('content-length');
          if (contentLength) {
            setFileMeta({ size: parseInt(contentLength, 10) });
          }
        }
      })
      .catch(() => {
        if (!isImage) {
          // If HEAD fails, try GET with range
          fetch(fileUrl, { headers: { 'Range': 'bytes=0-0' } })
            .then(res => {
              if (!res.ok) {
                setFileNotFound(true);
                return;
              }
              // Extract filename from Content-Disposition header
              const disposition = res.headers.get('content-disposition');
              const headerFilename = getFilenameFromHeader(disposition);
              if (headerFilename) {
                setDisplayFilename(headerFilename);
              }
              const contentLength = res.headers.get('content-length');
              if (contentLength) {
                setFileMeta({ size: parseInt(contentLength, 10) });
              }
            })
            .catch(() => {
              // Silently fail, we'll just show the file without size info
            });
        }
      });
  }, [fileUrl, isImage]);

  // File not found
  if (fileNotFound) {
    return (
      <div
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '0.75rem',
          background: 'var(--bg-secondary)',
          border: '1px solid var(--border)',
          borderRadius: '8px',
          padding: '0.75rem 1rem',
          marginTop: '0.35rem',
          maxWidth: 380,
        }}
      >
        <div
          style={{
            width: 40,
            height: 40,
            borderRadius: '6px',
            flexShrink: 0,
            background: 'var(--bg-tertiary)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '1.5rem',
          }}
        >
          ❌
        </div>
        <div style={{ flex: 1, overflow: 'hidden', minWidth: 0 }}>
          <div
            style={{
              fontSize: '0.7rem',
              color: 'var(--text-muted)',
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              fontWeight: 700,
              marginBottom: '0.1rem',
            }}
          >
            File
          </div>
          <div
            style={{
              fontSize: '0.88rem',
              color: 'var(--text-primary)',
              fontWeight: 500,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            This file does not exist
          </div>
        </div>
      </div>
    );
  }

  // Image not found (404)
  if (isImage && imageNotFound) {
    return (
      <div
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '0.75rem',
          background: 'var(--bg-secondary)',
          border: '1px solid var(--border)',
          borderRadius: '8px',
          padding: '0.75rem 1rem',
          marginTop: '0.35rem',
          maxWidth: 380,
        }}
      >
        <div
          style={{
            width: 40,
            height: 40,
            borderRadius: '6px',
            flexShrink: 0,
            background: 'var(--bg-tertiary)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '1.5rem',
          }}
        >
          ❌
        </div>
        <div style={{ flex: 1, overflow: 'hidden', minWidth: 0 }}>
          <div
            style={{
              fontSize: '0.7rem',
              color: 'var(--text-muted)',
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              fontWeight: 700,
              marginBottom: '0.1rem',
            }}
          >
            Image
          </div>
          <div
            style={{
              fontSize: '0.88rem',
              color: 'var(--text-primary)',
              fontWeight: 500,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            This image does not exist
          </div>
        </div>
      </div>
    );
  }

  // Image renderer
  if (isImage && !imageError && !imageNotFound) {
    return (
      <>
        <div
          style={{
            marginTop: '0.35rem',
            maxWidth: 400,
            borderRadius: '8px',
            overflow: 'hidden',
            border: '1px solid var(--border)',
            position: 'relative',
            display: 'inline-block',
            cursor: 'pointer',
            transition: 'transform 0.2s, box-shadow 0.2s',
          }}
          onClick={() => setShowModal(true)}
          onMouseEnter={e => {
            e.currentTarget.style.transform = 'scale(1.02)';
            e.currentTarget.style.boxShadow = '0 8px 24px rgba(0, 0, 0, 0.3)';
          }}
          onMouseLeave={e => {
            e.currentTarget.style.transform = 'scale(1)';
            e.currentTarget.style.boxShadow = 'none';
          }}
        >
          <img
            src={fileUrl}
            alt="Embedded image"
            onError={() => setImageError(true)}
            onLoad={() => setImageLoading(false)}
            onContextMenu={(e) => {
              e.stopPropagation();
              if (onImageContextMenu) {
                onImageContextMenu(e);
              }
            }}
            style={{
              width: '100%',
              display: 'block',
              maxHeight: 500,
              objectFit: 'cover',
              opacity: imageLoading ? 0.6 : 1,
              transition: 'opacity 0.2s',
            }}
          />
          <button
            onClick={e => {
              e.stopPropagation();
              triggerDownload(fileUrl, filename);
            }}
          title="Download image"
          style={{
            position: 'absolute',
            top: '0.5rem',
            right: '0.5rem',
            background: 'rgba(0, 0, 0, 0.6)',
            border: 'none',
            borderRadius: '6px',
            padding: '0.4rem 0.6rem',
            color: '#fff',
            fontSize: '0.9rem',
            cursor: 'pointer',
            transition: 'background 0.15s',
            display: 'flex',
            alignItems: 'center',
            gap: '0.3rem',
            backdropFilter: 'blur(4px)',
          }}
          onMouseEnter={e => (e.currentTarget.style.background = 'rgba(0, 0, 0, 0.8)')}
          onMouseLeave={e => (e.currentTarget.style.background = 'rgba(0, 0, 0, 0.6)')}
        >
          ⬇️
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

  // Fallback for failed image load (generic error) - show as file embed
  if (isImage && imageError && !imageNotFound) {
    return (
      <div
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '0.75rem',
          background: 'var(--bg-secondary)',
          border: '1px solid var(--border)',
          borderRadius: '8px',
          padding: '0.75rem 1rem',
          marginTop: '0.35rem',
          maxWidth: 380,
        }}
      >
        <div
          style={{
            width: 40,
            height: 40,
            borderRadius: '6px',
            flexShrink: 0,
            background: 'var(--bg-tertiary)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '1.5rem',
          }}
        >
          🖼️
        </div>
        <div style={{ flex: 1, overflow: 'hidden', minWidth: 0 }}>
          <div
            style={{
              fontSize: '0.7rem',
              color: 'var(--text-muted)',
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              fontWeight: 700,
              marginBottom: '0.1rem',
            }}
          >
            Image
          </div>
          <div
            style={{
              fontSize: '0.88rem',
              color: 'var(--text-primary)',
              fontWeight: 500,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {filename}
          </div>
        </div>
        <button
          onClick={() => triggerDownload(fileUrl, filename)}
          title="Download file"
          style={{
            background: 'var(--accent)',
            border: 'none',
            borderRadius: '6px',
            padding: '0.4rem 0.85rem',
            color: '#fff',
            fontSize: '0.82rem',
            fontWeight: 600,
            cursor: 'pointer',
            flexShrink: 0,
            transition: 'background 0.15s',
            whiteSpace: 'nowrap',
          }}
          onMouseEnter={e => (e.currentTarget.style.background = 'var(--accent-hover)')}
          onMouseLeave={e => (e.currentTarget.style.background = 'var(--accent)')}
        >
          Download
        </button>
      </div>
    );
  }

  // File embed (non-image)
  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '0.75rem',
        background: 'var(--bg-secondary)',
        border: '1px solid var(--border)',
        borderRadius: '8px',
        padding: '0.75rem 1rem',
        marginTop: '0.35rem',
        maxWidth: 380,
      }}
    >
      {/* File icon */}
      <div
        style={{
          width: 40,
          height: 40,
          borderRadius: '6px',
          flexShrink: 0,
          background: 'var(--bg-tertiary)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '1.5rem',
        }}
      >
        📄
      </div>

      {/* File info */}
      <div style={{ flex: 1, overflow: 'hidden', minWidth: 0 }}>
        <div
          style={{
            fontSize: '0.7rem',
            color: 'var(--text-muted)',
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
            fontWeight: 700,
            marginBottom: '0.1rem',
          }}
        >
          File
        </div>
        <div
          style={{
            fontSize: '0.88rem',
            color: 'var(--text-primary)',
            fontWeight: 500,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {filename}
        </div>
        {fileMeta?.size && (
          <div
            style={{
              fontSize: '0.75rem',
              color: 'var(--text-muted)',
              marginTop: '0.15rem',
            }}
          >
            {formatFileSize(fileMeta.size)}
          </div>
        )}
      </div>

      {/* Download button */}
      <button
        onClick={() => triggerDownload(fileUrl, filename)}
        title="Download file"
        style={{
          background: 'var(--accent)',
          border: 'none',
          borderRadius: '6px',
          padding: '0.4rem 0.85rem',
          color: '#fff',
          fontSize: '0.82rem',
          fontWeight: 600,
          cursor: 'pointer',
          flexShrink: 0,
          transition: 'background 0.15s',
          whiteSpace: 'nowrap',
        }}
        onMouseEnter={e => (e.currentTarget.style.background = 'var(--accent-hover)')}
        onMouseLeave={e => (e.currentTarget.style.background = 'var(--accent)')}
      >
        Download
      </button>
    </div>
  );
}
