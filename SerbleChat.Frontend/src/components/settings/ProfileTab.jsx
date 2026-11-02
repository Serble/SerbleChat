import { Fragment, useState, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import { useApp } from '../../context/AppContext.jsx';
import { openExternalLink } from '../../electron-utils.js';
import { uploadProfilePicture, deleteProfilePicture } from '../../api.js';
import { noteUser } from '../../imageVersions.js';
import { nameTextColor, bannerBg } from '../../userColor.js';
import Avatar from '../Avatar.jsx';
import { Button, TextInput, TextArea, SaveStatus, SectionTitle, Hint, useFlashStatus } from '../ui/index.js';
import { TabBody, HEX_COLOR_RE } from './common.jsx';

const BLURB_MAX = 1024;
const PFP_MAX_BYTES = 5 * 1024 * 1024;
const DEFAULT_PICKER_COLOR = '#5865f2';
const BLURB_REMARK_PLUGINS = [remarkGfm, remarkBreaks];

const BLURB_MD_COMPONENTS = {
  p:      ({ children }) => <p style={{ margin: '0 0 0.45em', lineHeight: 1.6 }}>{children}</p>,
  a:      ({ href, children }) => (
    <a href={href} target="_blank" rel="noopener noreferrer"
      style={{ color: 'var(--accent)', textDecoration: 'underline', wordBreak: 'break-all' }}
      onClick={e => { if (href) { e.preventDefault(); openExternalLink(href); } }}>
      {children}
    </a>
  ),
  strong: ({ children }) => <strong style={{ color: 'var(--text-primary)', fontWeight: 700 }}>{children}</strong>,
  em:     ({ children }) => <em style={{ fontStyle: 'italic' }}>{children}</em>,
  code:   ({ children }) => (
    <code style={{
      background: 'rgba(255,255,255,0.1)', borderRadius: '3px',
      padding: '0.1em 0.35em', fontSize: '0.85em', fontFamily: 'monospace',
      color: 'var(--text-primary)',
    }}>{children}</code>
  ),
  pre:    ({ children }) => (
    <pre style={{
      background: 'var(--bg-tertiary)', borderRadius: '6px',
      padding: '0.5rem 0.7rem', overflowX: 'auto',
      fontSize: '0.82rem', lineHeight: 1.5, margin: '0.4em 0',
      border: '1px solid var(--border)',
    }}>{children}</pre>
  ),
  ul:     ({ children }) => <ul style={{ margin: '0.3em 0', paddingLeft: '1.3em' }}>{children}</ul>,
  ol:     ({ children }) => <ol style={{ margin: '0.3em 0', paddingLeft: '1.3em' }}>{children}</ol>,
  li:     ({ children }) => <li style={{ margin: '0.15em 0' }}>{children}</li>,
  blockquote: ({ children }) => (
    <blockquote style={{
      margin: '0.35em 0', paddingLeft: '0.7rem',
      borderLeft: '3px solid var(--accent)',
      color: 'var(--text-muted)', fontStyle: 'italic',
    }}>{children}</blockquote>
  ),
  h1: ({ children }) => <div style={{ fontSize: '1.05em', fontWeight: 700, margin: '0.5em 0 0.2em', color: 'var(--text-primary)' }}>{children}</div>,
  h2: ({ children }) => <div style={{ fontSize: '1em',    fontWeight: 700, margin: '0.5em 0 0.2em', color: 'var(--text-primary)' }}>{children}</div>,
  h3: ({ children }) => <div style={{ fontSize: '0.95em', fontWeight: 700, margin: '0.5em 0 0.2em', color: 'var(--text-primary)' }}>{children}</div>,
  hr:  () => <hr style={{ border: 'none', borderTop: '1px solid var(--border)', margin: '0.6em 0' }} />,
  img: ({ src, alt }) => (
    <img src={src} alt={alt ?? ''} style={{ maxWidth: '100%', borderRadius: '5px', display: 'block', margin: '0.4em 0' }} />
  ),
};

const MARKDOWN_REFERENCE = [
  ['**bold**',         'Bold text'],
  ['*italic*',         'Italic text'],
  ['`code`',           'Inline code'],
  ['[text](url)',      'Hyperlink'],
  ['> quote',          'Block quote'],
  ['# Heading',        'Heading (1–3 levels)'],
  ['- item',           'Bullet list'],
  ['1. item',          'Numbered list'],
  ['---',              'Horizontal rule'],
  ['```\\ncode\\n```', 'Code block'],
];

const PFP_STATUS_TEXT = {
  uploading:    ['saving', 'Uploading…'],
  deleting:     ['saving', 'Deleting…'],
  uploaded:     ['saved',  'Uploaded'],
  deleted:      ['saved',  'Deleted'],
  error:        ['error',  'Failed'],
  'error-type': ['error',  'Only images allowed'],
  'error-size': ['error',  'Max 5MB'],
};

const smallLabelStyle = {
  fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase',
  letterSpacing: '0.07em', fontWeight: 700,
};

// ─── Profile picture ──────────────────────────────────────────────────────────

function ProfilePictureSection({ currentUser, avatarKey, onChanged }) {
  const [status, flash, setStatus] = useFlashStatus();
  const inputRef = useRef(null);
  const busy = status === 'uploading' || status === 'deleting';

  async function handleUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';

    if (!file.type.startsWith('image/')) return flash('error-type', 3000);
    if (file.size > PFP_MAX_BYTES) return flash('error-size', 3000);

    setStatus('uploading');
    try {
      const result = await uploadProfilePicture(file);
      // A new version is a new URL everywhere the avatar shows (an older server sends none: just re-render)
      if (typeof result?.avatarVersion === 'number') noteUser({ id: currentUser?.id, avatarVersion: result.avatarVersion });
      onChanged();
      flash('uploaded');
    } catch (err) {
      console.error(err);
      flash('error', 3000);
    }
  }

  async function handleDelete() {
    if (!confirm('Delete your profile picture?')) return;
    setStatus('deleting');
    try {
      await deleteProfilePicture();
      noteUser({ id: currentUser?.id, avatarVersion: 0 });
      onChanged();
      flash('deleted');
    } catch (err) {
      console.error(err);
      flash('error', 3000);
    }
  }

  const [statusKind, statusText] = PFP_STATUS_TEXT[status] ?? [];

  return (
    <>
      <SectionTitle>Profile Picture</SectionTitle>
      <Hint style={{ marginBottom: '1rem' }}>
        Upload a custom profile picture. If no picture is set, a coloured circle with your initial will be shown.
      </Hint>

      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '1.25rem', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          <div style={smallLabelStyle}>Current</div>
          <Avatar key={avatarKey} userId={currentUser?.id} name={currentUser?.username} size={80} color={currentUser?.color} />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', paddingTop: '1.4rem' }}>
          <input ref={inputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleUpload} />
          <Button variant="primary" onClick={() => inputRef.current?.click()} disabled={busy}>
            {status === 'uploading' ? 'Uploading…' : 'Upload Picture'}
          </Button>
          <Button variant="danger-outline" onClick={handleDelete} disabled={busy}>
            {status === 'deleting' ? 'Deleting…' : 'Remove Picture'}
          </Button>
          {!busy && <SaveStatus status={statusKind} okText={statusText} errorText={statusText} />}
        </div>
      </div>
    </>
  );
}

// ─── User colour ──────────────────────────────────────────────────────────────

function ColourSection({ currentUser, updateUserDefaultPrefs, avatarKey }) {
  const savedColor = currentUser?.color ?? '';
  const [draft, setDraft] = useState(savedColor);
  const [status, flash, setStatus] = useFlashStatus();

  useEffect(() => { setDraft(currentUser?.color ?? ''); }, [currentUser?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const name = currentUser?.username ?? '?';
  const draftValid = draft === '' || HEX_COLOR_RE.test(draft);
  const previewColor = HEX_COLOR_RE.test(draft) ? draft : '';
  const dirty = draft !== savedColor;

  async function save(color) {
    setStatus('saving');
    try {
      await updateUserDefaultPrefs({ color });
      flash('saved');
    } catch {
      flash('error');
    }
  }

  function handleReset() {
    setDraft('');
    save('');
  }

  return (
    <>
      <SectionTitle>User Colour</SectionTitle>
      <Hint style={{ marginBottom: '1rem' }}>
        Your colour is used for your avatar, profile banner, and username across the app.
        Leave it unset to use the auto-generated colour based on your username.
      </Hint>

      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '1.25rem', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <input
              type="color"
              value={previewColor || DEFAULT_PICKER_COLOR}
              onChange={e => setDraft(e.target.value)}
              style={{
                width: 44, height: 44, padding: 3, borderRadius: 8, flexShrink: 0,
                border: '1px solid var(--border)', background: 'var(--bg-input)', cursor: 'pointer',
              }}
            />
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
              <TextInput
                mono
                value={draft}
                onChange={e => setDraft(e.target.value.trim())}
                maxLength={7}
                placeholder="#rrggbb"
                style={{ width: 110, borderColor: draftValid ? undefined : 'var(--danger)' }}
              />
              <div style={{ fontSize: '0.72rem', color: draftValid ? 'var(--text-subtle)' : 'var(--danger)' }}>
                {draftValid ? 'Hex value' : 'Use #rrggbb'}
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <Button variant="primary" onClick={() => save(draft)} disabled={!dirty || !draftValid || status === 'saving'}>
              Apply
            </Button>
            {savedColor !== '' && (
              <Button variant="danger-outline" onClick={handleReset} disabled={status === 'saving'}>Reset</Button>
            )}
            <SaveStatus status={status} />
          </div>
        </div>

        {/* Live preview */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          <div style={smallLabelStyle}>Preview</div>
          <div style={{
            display: 'flex', alignItems: 'center', gap: '0.65rem', padding: '0.55rem 0.75rem', width: 200,
            background: 'var(--bg-secondary)', borderRadius: 8, border: '1px solid var(--border)',
          }}>
            <Avatar key={avatarKey} userId={currentUser?.id} name={name} size={36} color={previewColor} />
            <span style={{ fontWeight: 600, fontSize: '0.9rem', color: nameTextColor(name, previewColor) }}>{name}</span>
          </div>
          <div style={{
            width: 200, background: 'var(--bg-overlay)', borderRadius: 8,
            border: '1px solid var(--border)', overflow: 'hidden',
          }}>
            <div style={{ height: 36, background: bannerBg(name, previewColor) }} />
            <div style={{ position: 'relative', padding: '0 0.75rem' }}>
              <div style={{ position: 'absolute', top: -22, background: 'var(--bg-overlay)', borderRadius: '50%', padding: 2 }}>
                <Avatar key={avatarKey} userId={currentUser?.id} name={name} size={38} color={previewColor} />
              </div>
            </div>
            <div style={{ padding: '1.6rem 0.75rem 0.6rem', fontWeight: 800, fontSize: '0.85rem', color: nameTextColor(name, previewColor) }}>
              {name}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

// ─── About me ─────────────────────────────────────────────────────────────────

function BlurbSection({ currentUser, updateUserDefaultPrefs }) {
  const [draft, setDraft] = useState(currentUser?.blurb ?? '');
  const [showPreview, setShowPreview] = useState(false);
  const [status, flash, setStatus] = useFlashStatus();

  useEffect(() => { setDraft(currentUser?.blurb ?? ''); }, [currentUser?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const remaining = BLURB_MAX - draft.length;
  const dirty = draft !== (currentUser?.blurb ?? '');

  async function handleSave() {
    if (status === 'saving') return;
    setStatus('saving');
    try {
      await updateUserDefaultPrefs({ blurb: draft });
      flash('saved');
    } catch {
      flash('error');
    }
  }

  return (
    <>
      <SectionTitle>About Me</SectionTitle>
      <Hint style={{ marginBottom: '0.85rem' }}>
        Write a short blurb about yourself. It will be visible to other users when they click on your name.{' '}
        <span style={{ color: 'var(--text-secondary)' }}>Markdown is supported.</span>
      </Hint>

      <div style={{ display: 'flex', marginBottom: '0.6rem', width: 'fit-content' }}>
        {['Edit', 'Preview'].map((label, i) => {
          const active = (label === 'Preview') === showPreview;
          return (
            <button
              key={label}
              onClick={() => setShowPreview(label === 'Preview')}
              style={{
                padding: '0.3rem 0.85rem', fontSize: '0.8rem', fontWeight: active ? 600 : 400,
                background: active ? 'var(--bg-active)' : 'transparent',
                border: '1px solid var(--border)',
                borderLeftWidth: i === 0 ? 1 : 0,
                borderRadius: i === 0 ? '6px 0 0 6px' : '0 6px 6px 0',
                color: active ? 'var(--text-primary)' : 'var(--text-muted)',
                cursor: 'pointer', transition: 'background 0.12s, color 0.12s',
              }}
            >
              {label}
            </button>
          );
        })}
      </div>

      {!showPreview ? (
        <TextArea
          mono
          value={draft}
          onChange={e => setDraft(e.target.value.slice(0, BLURB_MAX))}
          placeholder="Tell others a little about yourself… (Markdown supported)"
          rows={7}
          style={{ resize: 'vertical', borderRadius: 8, lineHeight: 1.6, padding: '0.65rem 0.85rem', display: 'block' }}
        />
      ) : (
        <div style={{
          minHeight: 120, background: 'var(--bg-input)', border: '1px solid var(--border)',
          borderRadius: 8, padding: '0.65rem 0.85rem',
          fontSize: '0.9rem', color: 'var(--text-secondary)',
          lineHeight: 1.6, wordBreak: 'break-word',
        }}>
          {draft.trim()
            ? <ReactMarkdown remarkPlugins={BLURB_REMARK_PLUGINS} components={BLURB_MD_COMPONENTS}>{draft}</ReactMarkdown>
            : <span style={{ color: 'var(--text-subtle)', fontStyle: 'italic' }}>Nothing to preview.</span>}
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.55rem', gap: '0.75rem' }}>
        <span style={{ fontSize: '0.75rem', color: remaining < 50 ? 'var(--danger)' : 'var(--text-muted)' }}>
          {remaining} / {BLURB_MAX} characters remaining
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <SaveStatus status={status} errorText="Failed to save" />
          <Button variant="primary" onClick={handleSave} disabled={!dirty || status === 'saving'}>Save</Button>
        </div>
      </div>

      <details style={{ marginTop: '1.5rem' }}>
        <summary style={{ fontSize: '0.78rem', color: 'var(--text-muted)', cursor: 'pointer', userSelect: 'none' }}>
          Markdown reference
        </summary>
        <div style={{
          marginTop: '0.6rem', background: 'var(--bg-secondary)',
          border: '1px solid var(--border)', borderRadius: 8,
          padding: '0.75rem 1rem', fontSize: '0.8rem', color: 'var(--text-muted)',
          display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '0.25rem 1rem', lineHeight: 1.7,
        }}>
          {MARKDOWN_REFERENCE.map(([syntax, desc]) => (
            <Fragment key={syntax}>
              <code style={{
                fontFamily: 'ui-monospace, monospace', fontSize: '0.78rem',
                color: 'var(--text-secondary)', background: 'rgba(255,255,255,0.06)',
                padding: '0.05em 0.3em', borderRadius: 3, whiteSpace: 'nowrap', justifySelf: 'start',
              }}>{syntax}</code>
              <span>{desc}</span>
            </Fragment>
          ))}
        </div>
      </details>
    </>
  );
}

export default function ProfileTab() {
  const { currentUser, updateUserDefaultPrefs } = useApp();
  // Bumped after a picture upload/delete to remount the avatars and refetch the image.
  const [avatarKey, setAvatarKey] = useState(0);

  return (
    <TabBody>
      <ProfilePictureSection currentUser={currentUser} avatarKey={avatarKey} onChanged={() => setAvatarKey(k => k + 1)} />
      <ColourSection currentUser={currentUser} updateUserDefaultPrefs={updateUserDefaultPrefs} avatarKey={avatarKey} />
      <BlurbSection currentUser={currentUser} updateUserDefaultPrefs={updateUserDefaultPrefs} />
    </TabBody>
  );
}
