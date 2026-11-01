import { useRef, useState } from 'react';
import { UploadIcon, TrashIcon } from '../../icons.jsx';
import { Button, ErrorBox } from './controls.jsx';

/**
 * Square icon preview with Upload / Remove buttons beside it.
 * `src` is the current icon URL or null (then `fallback` is shown instead).
 * `onUpload(file)` / `onRemove()` are async; busy and error state is handled
 * here. The preview itself refreshes via the server's *Updated signal.
 */
export default function IconUploadField({ src, fallback, alt, onUpload, onRemove, onImageError, hint, size = 88, disabled }) {
  const fileRef = useRef(null);
  const [busy, setBusy] = useState(null); // 'upload' | 'remove' | null
  const [error, setError] = useState(null);

  async function run(kind, action) {
    setBusy(kind);
    setError(null);
    try { await action(); }
    catch (err) { setError(err.message); }
    finally { setBusy(null); }
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
        <button
          type="button"
          className="ui-icon-upload"
          style={{ width: size, height: size }}
          onClick={() => fileRef.current?.click()}
          disabled={disabled || !!busy}
          title="Upload image"
        >
          {src
            ? <img src={src} alt={alt} onError={onImageError} />
            : <span className="ui-icon-upload-fallback">{fallback}</span>}
          {!disabled && <span className="ui-icon-upload-overlay"><UploadIcon size={18} /></span>}
        </button>

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '0.5rem', minWidth: 0 }}>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            hidden
            onChange={e => {
              const file = e.target.files?.[0];
              e.target.value = ''; // allow re-selecting the same file
              if (file) run('upload', () => onUpload(file));
            }}
          />
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <Button size="sm" onClick={() => fileRef.current?.click()} disabled={disabled || !!busy}>
              <UploadIcon size={13} /> {busy === 'upload' ? 'Uploading…' : src ? 'Change' : 'Upload Image'}
            </Button>
            {src && (
              <Button size="sm" variant="danger-outline" onClick={() => run('remove', onRemove)} disabled={disabled || !!busy}>
                <TrashIcon size={13} /> {busy === 'remove' ? 'Removing…' : 'Remove'}
              </Button>
            )}
          </div>
          {hint && <div className="ui-hint">{hint}</div>}
        </div>
      </div>
      <ErrorBox style={{ marginTop: '0.75rem' }}>{error}</ErrorBox>
    </div>
  );
}
