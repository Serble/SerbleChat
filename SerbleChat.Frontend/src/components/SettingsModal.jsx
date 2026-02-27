import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import { useTheme, THEME_PROPS } from '../context/ThemeContext.jsx';
import { useClientOptions } from '../context/ClientOptionsContext.jsx';
import { useApp } from '../context/AppContext.jsx';
import { useMobile } from '../context/MobileContext.jsx';
import { isPushSupported, getPushUnsupportedReason, getPermissionState, isPushEnabled, enablePush, disablePush } from '../push.js';
import { uploadProfilePicture, deleteProfilePicture, getProfilePictureUrl } from '../api.js';
import Avatar from './Avatar.jsx';

const BLURB_REMARK_PLUGINS = [remarkGfm, remarkBreaks];

// ─── Theme editor helpers ─────────────────────────────────────────────────────

const GROUPS = [...new Set(THEME_PROPS.map(p => p.group))];

function groupedProps() {
  const map = {};
  for (const g of GROUPS) map[g] = THEME_PROPS.filter(p => p.group === g);
  return map;
}

function ColorRow({ label, value, onChange }) {
  const [localVal, setLocalVal] = useState(value);
  useEffect(() => { setLocalVal(value); }, [value]);

  function handleText(e) {
    const v = e.target.value;
    setLocalVal(v);
    if (/^#[0-9a-fA-F]{6}$/.test(v)) onChange(v);
  }
  function handlePicker(e) {
    setLocalVal(e.target.value);
    onChange(e.target.value);
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', padding: '0.3rem 0' }}>
      <input
        type="color"
        value={/^#[0-9a-fA-F]{6}$/.test(localVal) ? localVal : '#000000'}
        onChange={handlePicker}
        style={{
          width: 30, height: 30, padding: 2, borderRadius: 6,
          border: '1px solid var(--border)', background: 'var(--bg-input)',
          cursor: 'pointer', flexShrink: 0,
        }}
      />
      <input
        type="text"
        value={localVal}
        onChange={handleText}
        maxLength={7}
        style={{
          width: 80, background: 'var(--bg-input)', border: '1px solid var(--border)',
          borderRadius: 4, color: 'var(--text-secondary)', fontSize: '0.78rem',
          padding: '0.2rem 0.4rem', fontFamily: 'monospace', outline: 'none',
        }}
      />
      <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)', flex: 1 }}>{label}</span>
    </div>
  );
}

function ThemeListItem({ theme, active, editing, onSelect, onActivate, onDelete }) {
  const [hov, setHov] = useState(false);
  return (
    <div
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      onClick={onSelect}
      style={{
        display: 'flex', alignItems: 'center', gap: '0.4rem',
        padding: '0.4rem 0.5rem', borderRadius: 6, cursor: 'pointer',
        background: editing ? 'var(--bg-active)' : hov ? 'var(--bg-hover)' : 'transparent',
        transition: 'background 0.1s',
      }}
    >
      <div style={{ display: 'flex', flexShrink: 0, gap: 2 }}>
        {['bgBase', 'bgSecondary', 'accent'].map(k => (
          <div key={k} style={{ width: 10, height: 18, borderRadius: 2, background: theme.colors[k] ?? '#888' }} />
        ))}
      </div>
      <span style={{
        flex: 1, fontSize: '0.85rem', fontWeight: editing ? 600 : 400,
        color: editing ? 'var(--text-primary)' : 'var(--text-secondary)',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        {theme.name}
      </span>
      {active && !editing && (
        <span style={{ fontSize: '0.65rem', color: 'var(--success)', flexShrink: 0 }}>●</span>
      )}
      <div style={{ display: 'flex', gap: 2, flexShrink: 0 }}>
        <button
          title="Apply theme"
          onClick={e => { e.stopPropagation(); onActivate(); }}
          style={{
            background: active ? 'var(--accent)' : 'transparent',
            border: active ? 'none' : '1px solid var(--border)',
            borderRadius: 4, color: active ? '#fff' : 'var(--text-muted)',
            fontSize: '0.65rem', padding: '0.1rem 0.3rem', cursor: 'pointer',
          }}
        >
          {active ? '✓' : 'Use'}
        </button>
        {onDelete && (
          <button
            title="Delete theme"
            onClick={e => { e.stopPropagation(); onDelete(); }}
            style={{
              background: 'transparent', border: 'none',
              color: 'var(--text-subtle)', fontSize: '0.75rem',
              cursor: 'pointer', padding: '0.1rem 0.2rem', borderRadius: 3,
            }}
            className="hov-color-danger"
          >
            🗑
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Appearance Tab ───────────────────────────────────────────────────────────

function AppearanceTab() {
  const {
    allThemes, activeTheme, activeId,
    activateTheme, createTheme, updateTheme, deleteTheme,
  } = useTheme();

  const importInputRef = useRef(null);
  const [importError, setImportError] = useState(null);
  const [editingId, setEditingId] = useState(activeId);
  const editingTheme = allThemes.find(t => t.id === editingId) ?? allThemes[0];
  const [draftColors, setDraftColors] = useState({ ...editingTheme.colors });
  const [draftName, setDraftName] = useState(editingTheme.name);

  function selectForEdit(id) {
    setEditingId(id);
    const t = allThemes.find(th => th.id === id);
    if (t) { setDraftColors({ ...t.colors }); setDraftName(t.name); }
  }

  function setColor(key, val) {
    setDraftColors(prev => ({ ...prev, [key]: val }));
  }

  function handleApply() {
    if (editingTheme.builtIn) {
      const newId = createTheme(`${editingTheme.name} (custom)`, draftColors);
      activateTheme(newId);
      selectForEdit(newId);
    } else {
      updateTheme(editingId, { name: draftName, colors: draftColors });
      activateTheme(editingId);
    }
  }

  function handleNew() {
    const newId = createTheme('My Theme', { ...activeTheme.colors });
    selectForEdit(newId);
  }

  function handleDelete(id) {
    if (!confirm('Delete this theme?')) return;
    deleteTheme(id);
    selectForEdit('dark');
  }

  function handleExport() {
    const payload = { name: draftName, colors: draftColors };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(draftName || 'theme').replace(/[^a-z0-9_-]/gi, '_')}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleImportClick() {
    setImportError(null);
    importInputRef.current?.click();
  }

  function handleImportFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const parsed = JSON.parse(ev.target.result);
        if (!parsed || typeof parsed.colors !== 'object') throw new Error('Missing "colors" object');
        const validKeys = new Set(THEME_PROPS.map(p => p.key));
        const colors = {};
        for (const [k, v] of Object.entries(parsed.colors)) {
          if (validKeys.has(k) && /^#[0-9a-fA-F]{6}$/.test(v)) colors[k] = v;
        }
        if (Object.keys(colors).length === 0) throw new Error('No valid colour values found');
        const name = typeof parsed.name === 'string' && parsed.name.trim()
          ? parsed.name.trim()
          : file.name.replace(/\.json$/i, '');
        const newId = createTheme(name, { ...activeTheme.colors, ...colors });
        selectForEdit(newId);
        setImportError(null);
      } catch (err) {
        setImportError(`Import failed: ${err.message}`);
      }
    };
    reader.readAsText(file);
  }

  const groups = groupedProps();
  const isBuiltIn = editingTheme.builtIn;
  const { isMobile } = useMobile();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Hidden file input */}
      <input
        ref={importInputRef}
        type="file"
        accept=".json,application/json"
        style={{ display: 'none' }}
        onChange={handleImportFile}
      />

      {/* Two-panel body — stacks vertically on mobile */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden', flexDirection: isMobile ? 'column' : 'row' }}>
        {/* Theme list */}
        <div style={{
          width: isMobile ? '100%' : 190,
          height: isMobile ? 'auto' : undefined,
          maxHeight: isMobile ? '35%' : undefined,
          flexShrink: 0,
          borderRight: isMobile ? 'none' : '1px solid var(--border)',
          borderBottom: isMobile ? '1px solid var(--border)' : 'none',
          overflowY: 'auto', padding: '0.75rem 0.5rem',
          display: 'flex', flexDirection: isMobile ? 'row' : 'column',
          gap: '0.2rem', flexWrap: isMobile ? 'wrap' : 'nowrap',
        }}>
          {!isMobile && <div style={{ fontSize: '0.68rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', padding: '0 0.5rem 0.5rem' }}>
            Built-in
          </div>}
          {allThemes.filter(t => t.builtIn).map(t => (
            <ThemeListItem
              key={t.id}
              theme={t}
              active={activeId === t.id}
              editing={editingId === t.id}
              onSelect={() => selectForEdit(t.id)}
              onActivate={() => { activateTheme(t.id); selectForEdit(t.id); }}
            />
          ))}

          {!isMobile && <div style={{ fontSize: '0.68rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', padding: '0.75rem 0.5rem 0.5rem' }}>
            Custom
          </div>}
          {allThemes.filter(t => !t.builtIn).map(t => (
            <ThemeListItem
              key={t.id}
              theme={t}
              active={activeId === t.id}
              editing={editingId === t.id}
              onSelect={() => selectForEdit(t.id)}
              onActivate={() => { activateTheme(t.id); selectForEdit(t.id); }}
              onDelete={() => handleDelete(t.id)}
            />
          ))}
          {allThemes.filter(t => !t.builtIn).length === 0 && (
            <div style={{ fontSize: '0.78rem', color: 'var(--text-subtle)', padding: '0 0.5rem' }}>
              No custom themes yet.
            </div>
          )}

          {/* Bottom actions — hidden on mobile to keep horizontal list clean */}
          {!isMobile && (
          <div style={{ marginTop: 'auto', paddingTop: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
            <button
              onClick={handleNew}
              style={{
                background: 'none', border: '1px dashed var(--border)',
                borderRadius: 6, color: 'var(--text-muted)', fontSize: '0.8rem',
                padding: '0.5rem', cursor: 'pointer', textAlign: 'center',
                transition: 'color 0.15s, border-color 0.15s',
              }}
              className="hov-text-secondary-border"
            >
              + New Theme
            </button>
            <button
              onClick={handleImportClick}
              style={{
                background: 'none', border: '1px solid var(--border)',
                borderRadius: 6, color: 'var(--text-muted)', fontSize: '0.8rem',
                padding: '0.5rem', cursor: 'pointer', textAlign: 'center',
                transition: 'color 0.15s, border-color 0.15s',
              }}
              className="hov-text-secondary-border"
            >
              ⬆ Import JSON
            </button>
            {importError && (
              <div style={{ fontSize: '0.72rem', color: 'var(--danger)', padding: '0 0.25rem', lineHeight: 1.4 }}>
                {importError}
              </div>
            )}
          </div>
          )}
        </div>

        {/* Right: editor */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '1rem 1.25rem' }}>
          {/* Name row */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.25rem' }}>
            <input
              value={draftName}
              onChange={e => setDraftName(e.target.value)}
              disabled={isBuiltIn}
              placeholder="Theme name"
              style={{
                flex: 1,
                background: isBuiltIn ? 'transparent' : 'var(--bg-input)',
                border: isBuiltIn ? 'none' : '1px solid var(--border)',
                borderRadius: 4, color: 'var(--text-primary)',
                fontSize: '1rem', fontWeight: 700,
                padding: isBuiltIn ? 0 : '0.35rem 0.6rem',
                outline: 'none', cursor: isBuiltIn ? 'default' : 'text',
              }}
            />
            {isBuiltIn && (
              <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', background: 'var(--bg-active)', borderRadius: 4, padding: '0.2rem 0.5rem' }}>
                Built-in
              </span>
            )}
          </div>

          {/* Color groups */}
          {GROUPS.map(group => (
            <div key={group} style={{ marginBottom: '1rem' }}>
              <div style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: '0.4rem' }}>
                {group}
              </div>
              <div style={{ background: 'var(--bg-secondary)', borderRadius: 6, padding: '0.5rem 0.75rem' }}>
                {groups[group].map(prop => (
                  <ColorRow
                    key={prop.key}
                    label={prop.label}
                    value={draftColors[prop.key] ?? '#000000'}
                    onChange={val => setColor(prop.key, val)}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Footer */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: '0.75rem 1.25rem', borderTop: '1px solid var(--border)', flexShrink: 0,
      }}>
        <button
          onClick={handleExport}
          title="Export current theme as JSON"
          style={{
            background: 'var(--bg-active)', border: 'none', borderRadius: 6,
            color: 'var(--text-secondary)', padding: '0.45rem 1rem', fontSize: '0.875rem',
            cursor: 'pointer',
          }}
          className="hov-bg"
        >
          ⬇ Export JSON
        </button>
        <button
          onClick={handleApply}
          style={{
            background: 'var(--accent)', border: 'none', borderRadius: 6,
            color: '#fff', padding: '0.45rem 1.2rem', fontSize: '0.875rem',
            cursor: 'pointer', fontWeight: 600,
          }}
          className="hov-accent"
        >
          {isBuiltIn ? 'Save as Custom & Apply' : 'Save & Apply'}
        </button>
      </div>
    </div>
  );
}

// ─── Profile Tab ─────────────────────────────────────────────────────────────

const BLURB_MAX = 1024;

/** Shared markdown components for blurb preview in settings. */
function BlurbPreviewMarkdown({ content }) {
  const components = {
    p:      ({ children }) => <p style={{ margin: '0 0 0.45em', lineHeight: 1.6 }}>{children}</p>,
    a:      ({ href, children }) => (
      <a href={href} target="_blank" rel="noopener noreferrer"
        style={{ color: 'var(--accent)', textDecoration: 'underline', wordBreak: 'break-all' }}>
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
  return (
    <ReactMarkdown remarkPlugins={BLURB_REMARK_PLUGINS} components={components}>
      {content}
    </ReactMarkdown>
  );
}

function ProfileTab() {
  const { currentUser, updateUserDefaultPrefs } = useApp();

  // ── Profile picture state ──────────────────────────────────────────────────
  const [pfpKey, setPfpKey] = useState(0); // force re-render of avatar
  const [pfpUploading, setPfpUploading] = useState(false);
  const [pfpDeleting, setPfpDeleting] = useState(false);
  const [pfpStatus, setPfpStatus] = useState(null);
  const pfpInputRef = useRef(null);

  // ── Colour state ───────────────────────────────────────────────────────────
  const [colorDraft,       setColorDraft]       = useState(currentUser?.color ?? '');
  const [colorHex,         setColorHex]         = useState(
    currentUser?.color && currentUser.color !== '' ? currentUser.color : '#5865f2'
  );
  const [colorSaveStatus,  setColorSaveStatus]  = useState(null);
  const colorTimerRef = useRef(null);

  // ── Blurb state ────────────────────────────────────────────────────────────
  const [draft,       setDraft]       = useState(currentUser?.blurb ?? '');
  const [saveStatus,  setSaveStatus]  = useState(null);
  const [showPreview, setShowPreview] = useState(false);
  const saveTimerRef  = useRef(null);

  // Sync when currentUser loads / changes account
  useEffect(() => {
    if (!currentUser) return;
    setDraft(currentUser.blurb ?? '');
    setColorDraft(currentUser.color ?? '');
    setColorHex(currentUser.color && currentUser.color !== '' ? currentUser.color : '#5865f2');
  }, [currentUser?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Profile picture handlers ───────────────────────────────────────────────
  async function handlePfpUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = ''; // reset input

    if (!file.type.startsWith('image/')) {
      setPfpStatus('error-type');
      setTimeout(() => setPfpStatus(null), 3000);
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      setPfpStatus('error-size');
      setTimeout(() => setPfpStatus(null), 3000);
      return;
    }

    setPfpUploading(true);
    setPfpStatus('uploading');
    try {
      await uploadProfilePicture(file);
      setPfpStatus('success');
      setPfpKey(k => k + 1); // force avatar re-render
      setTimeout(() => setPfpStatus(null), 2500);
    } catch (err) {
      console.error(err);
      setPfpStatus('error');
      setTimeout(() => setPfpStatus(null), 3000);
    } finally {
      setPfpUploading(false);
    }
  }

  async function handlePfpDelete() {
    if (!confirm('Delete your profile picture?')) return;
    setPfpDeleting(true);
    setPfpStatus('deleting');
    try {
      await deleteProfilePicture();
      setPfpStatus('deleted');
      setPfpKey(k => k + 1); // force avatar re-render
      setTimeout(() => setPfpStatus(null), 2500);
    } catch (err) {
      console.error(err);
      setPfpStatus('error');
      setTimeout(() => setPfpStatus(null), 3000);
    } finally {
      setPfpDeleting(false);
    }
  }

  // ── Colour handlers ────────────────────────────────────────────────────────
  const hasCustomColor = colorDraft !== '';
  const colorDirty = colorDraft !== (currentUser?.color ?? '');

  async function saveColor(newColor) {
    setColorSaveStatus('saving');
    clearTimeout(colorTimerRef.current);
    try {
      await updateUserDefaultPrefs({ color: newColor });
      setColorSaveStatus('saved');
    } catch {
      setColorSaveStatus('error');
    }
    colorTimerRef.current = setTimeout(() => setColorSaveStatus(null), 2500);
  }

  function handlePickerChange(e) {
    setColorHex(e.target.value);
    setColorDraft(e.target.value);
  }

  function handleHexTextChange(e) {
    const v = e.target.value;
    setColorDraft(v);
    if (/^#[0-9a-fA-F]{6}$/.test(v)) setColorHex(v);
  }

  function handleColorSave() {
    if (colorSaveStatus === 'saving') return;
    saveColor(colorDraft);
  }

  function handleColorReset() {
    setColorDraft('');
    setColorHex('#5865f2');
    saveColor('');
  }

  // ── Blurb handlers ─────────────────────────────────────────────────────────
  const remaining = BLURB_MAX - draft.length;
  const dirty     = draft !== (currentUser?.blurb ?? '');

  async function handleSave() {
    if (saveStatus === 'saving') return;
    setSaveStatus('saving');
    clearTimeout(saveTimerRef.current);
    try {
      await updateUserDefaultPrefs({ blurb: draft });
      setSaveStatus('saved');
    } catch {
      setSaveStatus('error');
    }
    saveTimerRef.current = setTimeout(() => setSaveStatus(null), 2500);
  }

  // ── Avatar preview helper ──────────────────────────────────────────────────
  const previewName = currentUser?.username ?? '?';
  const previewColor = colorDraft;
  const previewInitial = previewName[0].toUpperCase();
  // Use the same avatarBg logic inline (importing from userColor.js would need a dynamic import; inline is simpler here)
  function previewBg(name, color) {
    if (color && color !== '') return color;
    const hue = (name.charCodeAt(0) * 37 + name.charCodeAt(name.length - 1) * 17) % 360;
    return `hsl(${hue},45%,40%)`;
  }
  function previewNameColor(name, color) {
    if (color && color !== '') return color;
    const hue = (name.charCodeAt(0) * 37 + name.charCodeAt(name.length - 1) * 17) % 360;
    return `hsl(${hue},60%,72%)`;
  }

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '1.5rem 1.75rem' }}>

      {/* ── Profile Picture ────────────────────────────────────────────────── */}
      <div style={{
        fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-muted)',
        textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '1rem',
        paddingBottom: '0.4rem', borderBottom: '1px solid var(--border)',
      }}>
        Profile Picture
      </div>

      <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginBottom: '1rem', lineHeight: 1.55 }}>
        Upload a custom profile picture. If no picture is set, a colored circle with your initial will be shown.
      </div>

      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '1.25rem', marginBottom: '2rem', flexWrap: 'wrap' }}>
        {/* Avatar preview */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: 700 }}>Current</div>
          <Avatar key={pfpKey} userId={currentUser?.id} name={previewName} size={80} color={currentUser?.color} />
        </div>

        {/* Upload/delete controls */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          <input
            ref={pfpInputRef}
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={handlePfpUpload}
          />
          <button
            onClick={() => pfpInputRef.current?.click()}
            disabled={pfpUploading || pfpDeleting}
            style={{
              background: 'var(--accent)', border: 'none', borderRadius: 6,
              color: '#fff', padding: '0.5rem 1.2rem', fontSize: '0.83rem', fontWeight: 600,
              cursor: pfpUploading || pfpDeleting ? 'default' : 'pointer',
              opacity: pfpUploading || pfpDeleting ? 0.6 : 1,
              transition: 'background 0.15s, opacity 0.15s',
            }}
            className="hov-accent"
          >
            {pfpUploading ? 'Uploading…' : 'Upload Picture'}
          </button>
          <button
            onClick={handlePfpDelete}
            disabled={pfpUploading || pfpDeleting}
            style={{
              background: 'transparent', border: '1px solid var(--border)',
              borderRadius: 6, color: 'var(--text-muted)',
              padding: '0.5rem 1.2rem', fontSize: '0.83rem', fontWeight: 500,
              cursor: pfpUploading || pfpDeleting ? 'default' : 'pointer',
              opacity: pfpUploading || pfpDeleting ? 0.6 : 1,
              transition: 'color 0.15s, border-color 0.15s',
            }}
            onMouseEnter={e => { if (!pfpUploading && !pfpDeleting) { e.currentTarget.style.color = 'var(--danger)'; e.currentTarget.style.borderColor = 'rgba(242,63,67,0.4)'; } }}
            onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-muted)'; e.currentTarget.style.borderColor = 'var(--border)'; }}
          >
            {pfpDeleting ? 'Deleting…' : 'Remove Picture'}
          </button>
          {/* Status messages */}
          {pfpStatus === 'uploading' && <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>Uploading…</span>}
          {pfpStatus === 'success' && <span style={{ fontSize: '0.75rem', color: 'var(--success)', fontWeight: 600 }}>✓ Uploaded</span>}
          {pfpStatus === 'deleting' && <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>Deleting…</span>}
          {pfpStatus === 'deleted' && <span style={{ fontSize: '0.75rem', color: 'var(--success)', fontWeight: 600 }}>✓ Deleted</span>}
          {pfpStatus === 'error' && <span style={{ fontSize: '0.75rem', color: 'var(--danger)', fontWeight: 600 }}>❌ Failed</span>}
          {pfpStatus === 'error-type' && <span style={{ fontSize: '0.75rem', color: 'var(--danger)', fontWeight: 600 }}>❌ Only images allowed</span>}
          {pfpStatus === 'error-size' && <span style={{ fontSize: '0.75rem', color: 'var(--danger)', fontWeight: 600 }}>❌ Max 5MB</span>}
        </div>
      </div>

      {/* ── Colour ─────────────────────────────────────────────────────────── */}
      <div style={{
        fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-muted)',
        textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '1rem',
        paddingBottom: '0.4rem', borderBottom: '1px solid var(--border)',
      }}>
        User Colour
      </div>

      <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginBottom: '1rem', lineHeight: 1.55 }}>
        Your colour is used for your avatar, profile banner, and username across the app.
        Leave it unset to use the auto-generated colour based on your username.
      </div>

      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '1.25rem', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
        {/* Picker + hex input */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <input
              type="color"
              value={colorHex}
              onChange={handlePickerChange}
              style={{
                width: 44, height: 44, padding: 3, borderRadius: 8,
                border: '1px solid var(--border)', background: 'var(--bg-input)',
                cursor: 'pointer', flexShrink: 0,
              }}
            />
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
              <input
                type="text"
                value={colorDraft}
                onChange={handleHexTextChange}
                maxLength={7}
                placeholder="#rrggbb"
                style={{
                  width: 100, background: 'var(--bg-input)', border: '1px solid var(--border)',
                  borderRadius: 6, color: 'var(--text-primary)', fontSize: '0.9rem',
                  padding: '0.4rem 0.6rem', fontFamily: 'ui-monospace, monospace', outline: 'none',
                }}
                onFocus={e => { e.target.style.borderColor = 'var(--accent)'; }}
                onBlur={e  => { e.target.style.borderColor = 'var(--border)'; }}
              />
              <div style={{ fontSize: '0.72rem', color: 'var(--text-subtle)' }}>Hex value</div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginTop: '0.25rem' }}>
            <button
              onClick={handleColorSave}
              disabled={!colorDirty || colorSaveStatus === 'saving'}
              style={{
                background: colorDirty && colorSaveStatus !== 'saving' ? 'var(--accent)' : 'var(--bg-active)',
                border: 'none', borderRadius: 6,
                color: colorDirty && colorSaveStatus !== 'saving' ? '#fff' : 'var(--text-muted)',
                padding: '0.4rem 1rem', fontSize: '0.83rem', fontWeight: 600,
                cursor: colorDirty && colorSaveStatus !== 'saving' ? 'pointer' : 'default',
                transition: 'background 0.15s, color 0.15s',
              }}
            >
              Apply
            </button>
            {hasCustomColor && (
              <button
                onClick={handleColorReset}
                style={{
                  background: 'transparent', border: '1px solid var(--border)',
                  borderRadius: 6, color: 'var(--text-muted)',
                  padding: '0.4rem 0.85rem', fontSize: '0.83rem', fontWeight: 500,
                  cursor: 'pointer', transition: 'color 0.15s, border-color 0.15s',
                }}
                onMouseEnter={e => { e.currentTarget.style.color = 'var(--danger)'; e.currentTarget.style.borderColor = 'rgba(242,63,67,0.4)'; }}
                onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-muted)'; e.currentTarget.style.borderColor = 'var(--border)'; }}
              >
                Reset
              </button>
            )}
            {colorSaveStatus === 'saving' && <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>Saving…</span>}
            {colorSaveStatus === 'saved'  && <span style={{ fontSize: '0.75rem', color: 'var(--success)', fontWeight: 600 }}>✓ Saved</span>}
            {colorSaveStatus === 'error'  && <span style={{ fontSize: '0.75rem', color: 'var(--danger)', fontWeight: 600 }}>❌ Failed</span>}
          </div>
        </div>

        {/* Live preview */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: 700 }}>Preview</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', padding: '0.55rem 0.75rem', background: 'var(--bg-secondary)', borderRadius: 8, border: '1px solid var(--border)', minWidth: 200 }}>
            {/* Mini avatar */}
            <div style={{
              width: 36, height: 36, borderRadius: '50%', flexShrink: 0,
              background: previewBg(previewName, previewColor),
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: '#fff', fontWeight: 700, fontSize: 15, userSelect: 'none',
            }}>
              {previewInitial}
            </div>
            <span style={{ fontWeight: 600, fontSize: '0.9rem', color: previewNameColor(previewName, previewColor) }}>
              {previewName}
            </span>
          </div>
          {/* Mini popout banner preview */}
          <div style={{
            width: 200, background: 'var(--bg-overlay)', borderRadius: 8,
            border: '1px solid var(--border)', overflow: 'hidden',
          }}>
            <div style={{
              height: 36,
              background: previewColor && previewColor !== ''
                ? `linear-gradient(135deg, ${previewColor}cc 0%, ${previewColor}66 100%)`
                : (() => { const h = (previewName.charCodeAt(0) * 37 + previewName.charCodeAt(previewName.length - 1) * 17) % 360; return `hsl(${h},35%,22%)`; })(),
            }} />
            <div style={{ position: 'relative', padding: '0 0.75rem' }}>
              <div style={{
                position: 'absolute', top: -22,
                background: 'var(--bg-overlay)', borderRadius: '50%', padding: 2,
              }}>
                <div style={{
                  width: 38, height: 38, borderRadius: '50%',
                  background: previewBg(previewName, previewColor),
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: '#fff', fontWeight: 700, fontSize: 16,
                }}>
                  {previewInitial}
                </div>
              </div>
            </div>
            <div style={{ padding: '1.6rem 0.75rem 0.6rem' }}>
              <div style={{ fontWeight: 800, fontSize: '0.85rem', color: previewNameColor(previewName, previewColor) }}>{previewName}</div>
            </div>
          </div>
        </div>
      </div>

      {/* ── About Me ───────────────────────────────────────────────────────── */}
      <div style={{
        fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-muted)',
        textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '1rem',
        paddingBottom: '0.4rem', borderBottom: '1px solid var(--border)',
      }}>
        About Me
      </div>

      <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginBottom: '0.85rem', lineHeight: 1.55 }}>
        Write a short blurb about yourself. It will be visible to other users when they click on your name.{' '}
        <span style={{ color: 'var(--text-secondary)' }}>Markdown is supported.</span>
      </div>

      {/* Edit / Preview toggle */}
      <div style={{ display: 'flex', gap: '0', marginBottom: '0.6rem', width: 'fit-content' }}>
        {['Edit', 'Preview'].map(tab => {
          const active = (tab === 'Preview') === showPreview;
          return (
            <button key={tab} onClick={() => setShowPreview(tab === 'Preview')} style={{
              padding: '0.3rem 0.85rem', fontSize: '0.8rem', fontWeight: active ? 600 : 400,
              background: active ? 'var(--bg-active)' : 'transparent',
              border: '1px solid var(--border)', borderRadius: tab === 'Edit' ? '6px 0 0 6px' : '0 6px 6px 0',
              borderRight: tab === 'Edit' ? 'none' : '1px solid var(--border)',
              color: active ? 'var(--text-primary)' : 'var(--text-muted)',
              cursor: 'pointer', transition: 'background 0.12s, color 0.12s',
            }}>
              {tab}
            </button>
          );
        })}
      </div>

      {!showPreview ? (
        <textarea
          value={draft}
          onChange={e => setDraft(e.target.value.slice(0, BLURB_MAX))}
          placeholder="Tell others a little about yourself… (Markdown supported)"
          rows={7}
          style={{
            width: '100%', resize: 'vertical',
            background: 'var(--bg-input)', border: '1px solid var(--border)',
            borderRadius: '8px', color: 'var(--text-primary)',
            fontSize: '0.9rem', lineHeight: 1.6,
            padding: '0.65rem 0.85rem',
            outline: 'none', boxSizing: 'border-box',
            fontFamily: 'ui-monospace, "Fira Code", monospace',
            transition: 'border-color 0.15s',
          }}
          onFocus={e  => { e.target.style.borderColor = 'var(--accent)'; }}
          onBlur={e   => { e.target.style.borderColor = 'var(--border)'; }}
        />
      ) : (
        <div style={{
          minHeight: 120, background: 'var(--bg-input)', border: '1px solid var(--border)',
          borderRadius: '8px', padding: '0.65rem 0.85rem',
          fontSize: '0.9rem', color: 'var(--text-secondary)',
          lineHeight: 1.6, wordBreak: 'break-word',
        }}>
          {draft.trim()
            ? <BlurbPreviewMarkdown content={draft} />
            : <span style={{ color: 'var(--text-subtle)', fontStyle: 'italic' }}>Nothing to preview.</span>
          }
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.55rem' }}>
        <span style={{
          fontSize: '0.75rem',
          color: remaining < 50 ? 'var(--danger)' : 'var(--text-muted)',
        }}>
          {remaining} / {BLURB_MAX} characters remaining
        </span>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          {saveStatus === 'saving' && (
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>Saving…</span>
          )}
          {saveStatus === 'saved' && (
            <span style={{ fontSize: '0.75rem', color: 'var(--success)', fontWeight: 600 }}>✓ Saved</span>
          )}
          {saveStatus === 'error' && (
            <span style={{ fontSize: '0.75rem', color: 'var(--danger)', fontWeight: 600 }}>❌ Failed to save</span>
          )}
          <button
            onClick={handleSave}
            disabled={!dirty || saveStatus === 'saving'}
            style={{
              background: dirty && saveStatus !== 'saving' ? 'var(--accent)' : 'var(--bg-active)',
              border: 'none', borderRadius: '6px',
              color: dirty && saveStatus !== 'saving' ? '#fff' : 'var(--text-muted)',
              padding: '0.45rem 1.2rem', fontSize: '0.875rem', fontWeight: 600,
              cursor: dirty && saveStatus !== 'saving' ? 'pointer' : 'default',
              transition: 'background 0.15s, color 0.15s',
            }}
          >
            Save
          </button>
        </div>
      </div>

      {/* Markdown quick-reference */}
      <details style={{ marginTop: '1.5rem' }}>
        <summary style={{
          fontSize: '0.78rem', color: 'var(--text-muted)', cursor: 'pointer',
          userSelect: 'none', listStyle: 'none', display: 'flex', alignItems: 'center', gap: '0.4rem',
        }}>
          <span>▸</span> Markdown reference
        </summary>
        <div style={{
          marginTop: '0.6rem', background: 'var(--bg-secondary)',
          border: '1px solid var(--border)', borderRadius: '8px',
          padding: '0.75rem 1rem', fontSize: '0.8rem', color: 'var(--text-muted)',
          display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '0.25rem 1rem',
          lineHeight: 1.7,
        }}>
          {[
            ['**bold**',         'Bold text'],
            ['*italic*',         'Italic text'],
            ['`code`',           'Inline code'],
            ['[text](url)',       'Hyperlink'],
            ['> quote',          'Block quote'],
            ['# Heading',        'Heading (1–3 levels)'],
            ['- item',           'Bullet list'],
            ['1. item',          'Numbered list'],
            ['---',              'Horizontal rule'],
            ['```\\ncode\\n```', 'Code block'],
          ].map(([syntax, desc]) => (
            <>
              <code key={syntax + '-code'} style={{
                fontFamily: 'ui-monospace, monospace', fontSize: '0.78rem',
                color: 'var(--text-secondary)', background: 'rgba(255,255,255,0.06)',
                padding: '0.05em 0.3em', borderRadius: '3px', whiteSpace: 'nowrap',
              }}>{syntax}</code>
              <span key={syntax + '-desc'}>{desc}</span>
            </>
          ))}
        </div>
      </details>
    </div>
  );
}


// ─── Chat Tab ─────────────────────────────────────────────────────────────────

function ChatTab() {
  const { messageLinesLimit, setMessageLinesLimit, blockedMessageMode, setBlockedMessageMode } = useClientOptions();
  const [draft, setDraft] = useState(messageLinesLimit);

  // Keep draft in sync if context changes (e.g. after backend load)
  useEffect(() => { setDraft(messageLinesLimit); }, [messageLinesLimit]);

  function handleChange(e) {
    setDraft(e.target.value);
  }

  function handleBlur() {
    const n = Math.max(5, Math.min(200, parseInt(draft, 10) || messageLinesLimit));
    setDraft(n);
    setMessageLinesLimit(n);
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter') e.target.blur();
  }

  const BLOCKED_MODES = [
    {
      id: 'masked',
      label: 'Masked',
      icon: '🚫',
      description: 'Show a collapsed "message from blocked user" placeholder that can be expanded on click.',
    },
    {
      id: 'visible',
      label: 'Fully visible',
      icon: '👁️',
      description: 'Show messages from blocked users exactly like any other message.',
    },
    {
      id: 'hidden',
      label: 'Hidden',
      icon: '🗑️',
      description: 'Completely remove messages from blocked users — they will not appear at all.',
    },
  ];

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '1.5rem 1.75rem' }}>

      {/* ── Message Display ─────────────────────────────── */}
      <div style={{
        fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-muted)',
        textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '1rem',
        paddingBottom: '0.4rem', borderBottom: '1px solid var(--border)',
      }}>
        Message Display
      </div>

      {/* Message collapse limit */}
      <div style={{ marginBottom: '1.75rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '0.5rem' }}>
          <label style={{ flex: 1, fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-primary)' }}>
            Lines before collapse
          </label>
          <input
            type="number"
            value={draft}
            onChange={handleChange}
            onBlur={handleBlur}
            onKeyDown={handleKeyDown}
            min={5}
            max={200}
            style={{
              width: 72, background: 'var(--bg-input)', border: '1px solid var(--border)',
              borderRadius: 6, color: 'var(--text-primary)', fontSize: '0.9rem',
              padding: '0.35rem 0.6rem', outline: 'none', textAlign: 'center',
            }}
          />
        </div>
        <input
          type="range"
          min={5}
          max={100}
          value={Math.min(draft, 100)}
          onChange={e => {
            const n = parseInt(e.target.value, 10);
            setDraft(n);
            setMessageLinesLimit(n);
          }}
          style={{ width: '100%', accentColor: 'var(--accent)', cursor: 'pointer' }}
        />
        <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.5rem', lineHeight: 1.5 }}>
          Messages with more than <strong style={{ color: 'var(--text-secondary)' }}>{draft} lines</strong> will
          be visually collapsed with a "Show more" button. The full content is always
          retained — only the display is clipped. Range: 5–200.
        </div>
      </div>

      {/* ── Blocked Users ────────────────────────────────── */}
      <div style={{
        fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-muted)',
        textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '1rem',
        paddingBottom: '0.4rem', borderBottom: '1px solid var(--border)',
      }}>
        Blocked Users
      </div>

      <div style={{ marginBottom: '0.5rem' }}>
        <div style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.75rem' }}>
          Messages from blocked users
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {BLOCKED_MODES.map(mode => {
            const active = blockedMessageMode === mode.id;
            return (
              <div
                key={mode.id}
                onClick={() => setBlockedMessageMode(mode.id)}
                style={{
                  display: 'flex', alignItems: 'flex-start', gap: '0.85rem',
                  padding: '0.75rem 1rem', borderRadius: 8, cursor: 'pointer',
                  border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
                  background: active ? 'rgba(124,58,237,0.08)' : 'var(--bg-secondary)',
                  transition: 'border-color 0.15s, background 0.15s',
                }}
                className={!active ? 'hov-bg' : undefined}
              >
                {/* Radio circle */}
                <div style={{
                  width: 18, height: 18, borderRadius: '50%', flexShrink: 0, marginTop: 2,
                  border: `2px solid ${active ? 'var(--accent)' : 'var(--text-subtle)'}`,
                  background: active ? 'var(--accent)' : 'transparent',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  transition: 'border-color 0.15s, background 0.15s',
                }}>
                  {active && <div style={{ width: 7, height: 7, borderRadius: '50%', background: '#fff' }} />}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.2rem' }}>
                    <span style={{ fontSize: '0.95rem' }}>{mode.icon}</span>
                    <span style={{ fontSize: '0.9rem', fontWeight: 600, color: active ? 'var(--text-primary)' : 'var(--text-secondary)' }}>
                      {mode.label}
                    </span>
                    {mode.id === 'masked' && (
                      <span style={{ fontSize: '0.65rem', background: 'var(--bg-active)', color: 'var(--text-muted)', borderRadius: 4, padding: '0.1rem 0.4rem', fontWeight: 600 }}>
                        DEFAULT
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>
                    {mode.description}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

    </div>
  );
}

// ─── Notifications Tab ────────────────────────────────────────────────────────

// NotificationPreference enum: Inherit=0, AllMessages=1, MentionsOnly=2, Nothing=3
// For user defaults, Inherit is NOT valid (they are the bottom of the hierarchy).
const NOTIF_PREF_OPTIONS = [
  { value: 1, icon: '🔔', label: 'All Messages',  desc: 'Every new message' },
  { value: 2, icon: '💬', label: 'Mentions Only', desc: 'Only when @mentioned' },
  { value: 3, icon: '🔕', label: 'Nothing',       desc: 'Never notify' },
];

function NotifPrefPicker({ label, field, value, onChange }) {
  return (
    <div style={{ marginBottom: '1.25rem' }}>
      <div style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.55rem' }}>
        {label}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
        {NOTIF_PREF_OPTIONS.map(opt => {
          const active = value === opt.value;
          return (
            <div
              key={opt.value}
              onClick={() => onChange(opt.value)}
              style={{
                display: 'flex', alignItems: 'center', gap: '0.85rem',
                padding: '0.6rem 0.85rem', borderRadius: 8, cursor: 'pointer',
                border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
                background: active ? 'rgba(124,58,237,0.08)' : 'var(--bg-secondary)',
                transition: 'border-color 0.15s, background 0.15s',
              }}
              className={!active ? 'hov-bg' : undefined}
            >
              <div style={{
                width: 18, height: 18, borderRadius: '50%', flexShrink: 0,
                border: `2px solid ${active ? 'var(--accent)' : 'var(--text-subtle)'}`,
                background: active ? 'var(--accent)' : 'transparent',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                transition: 'all 0.15s',
              }}>
                {active && <div style={{ width: 7, height: 7, borderRadius: '50%', background: '#fff' }} />}
              </div>
              <span style={{ fontSize: '1rem' }}>{opt.icon}</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '0.875rem', fontWeight: active ? 600 : 400, color: active ? 'var(--text-primary)' : 'var(--text-secondary)' }}>
                  {opt.label}
                </div>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>{opt.desc}</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function NotifPrefsSection({ title, description, notifValue, unreadsValue, onNotifChange, onUnreadsChange }) {
  const { isMobile } = useMobile();
  return (
    <div style={{ marginBottom: '2rem' }}>
      <div style={{
        fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-muted)',
        textTransform: 'uppercase', letterSpacing: '0.08em',
        marginBottom: '0.3rem', paddingBottom: '0.4rem', borderBottom: '1px solid var(--border)',
      }}>
        {title}
      </div>
      {description && (
        <div style={{ fontSize: '0.8rem', color: 'var(--text-subtle)', marginBottom: '0.85rem', lineHeight: 1.5 }}>
          {description}
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: '1rem' }}>
        <NotifPrefPicker
          label="🔔 Notifications"
          field="notifications"
          value={notifValue}
          onChange={onNotifChange}
        />
        <NotifPrefPicker
          label="🔴 Unread Badge"
          field="unreads"
          value={unreadsValue}
          onChange={onUnreadsChange}
        />
      </div>
    </div>
  );
}

function NotificationsTab() {
  const { currentUser, updateUserDefaultPrefs } = useApp();
  const [saveStatus, setSaveStatus] = useState(null); // null | 'saving' | 'saved'
  const saveStatusTimerRef = useRef(null);

  // ── Push notification state ───────────────────────────────────────────────
  const [pushSupported, setPushSupported] = useState(false);
  const [pushEnabled,   setPushEnabled]   = useState(false);
  const [pushPending,   setPushPending]   = useState(false);
  // { outcome: 'ok'|'denied'|'error'|null, message: string }
  const [pushStatus, setPushStatus] = useState({ outcome: null, message: '' });

  useEffect(() => {
    setPushSupported(isPushSupported());
    setPushEnabled(isPushEnabled());
  }, []);

  async function handlePushToggle() {
    if (pushPending) return;
    setPushPending(true);
    setPushStatus({ outcome: null, message: '' });
    if (pushEnabled) {
      await disablePush();
      setPushEnabled(false);
    } else {
      const { outcome, message } = await enablePush();
      if (outcome === 'granted') {
        setPushEnabled(true);
      }
      setPushStatus({ outcome, message });
    }
    setPushPending(false);
  }

  // ── Default notification prefs ────────────────────────────────────────────

  const [dmNotif,    setDmNotif]    = useState(currentUser?.defaultDmNotificationPreferences?.notifications    ?? 1);
  const [dmUnreads,  setDmUnreads]  = useState(currentUser?.defaultDmNotificationPreferences?.unreads          ?? 1);
  const [grpNotif,   setGrpNotif]   = useState(currentUser?.defaultGroupNotificationPreferences?.notifications ?? 2);
  const [grpUnreads, setGrpUnreads] = useState(currentUser?.defaultGroupNotificationPreferences?.unreads       ?? 1);
  const [gldNotif,   setGldNotif]   = useState(currentUser?.defaultGuildNotificationPreferences?.notifications ?? 2);
  const [gldUnreads, setGldUnreads] = useState(currentUser?.defaultGuildNotificationPreferences?.unreads       ?? 1);
  const [notifsWhileOnline, setNotifsWhileOnline] = useState(currentUser?.notificationsWhileOnline ?? false);

  // Used to suppress auto-save when state is being synced from the server
  const pendingSyncRef = useRef(false);

  // Sync drafts when currentUser loads or changes account
  useEffect(() => {
    if (!currentUser) return;
    pendingSyncRef.current = true;
    setDmNotif(currentUser.defaultDmNotificationPreferences?.notifications    ?? 1);
    setDmUnreads(currentUser.defaultDmNotificationPreferences?.unreads          ?? 1);
    setGrpNotif(currentUser.defaultGroupNotificationPreferences?.notifications ?? 2);
    setGrpUnreads(currentUser.defaultGroupNotificationPreferences?.unreads       ?? 1);
    setGldNotif(currentUser.defaultGuildNotificationPreferences?.notifications ?? 2);
    setGldUnreads(currentUser.defaultGuildNotificationPreferences?.unreads       ?? 1);
    setNotifsWhileOnline(currentUser.notificationsWhileOnline ?? false);
  }, [currentUser?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-save with debounce whenever any pref value changes
  useEffect(() => {
    // Skip saves triggered by the server-sync effect above
    if (pendingSyncRef.current) {
      pendingSyncRef.current = false;
      return;
    }
    // Don't save before currentUser is loaded
    if (!currentUser) return;

    setSaveStatus('saving');
    const t = setTimeout(async () => {
      await updateUserDefaultPrefs({
        defaultDmNotificationPreferences:    { notifications: dmNotif,    unreads: dmUnreads },
        defaultGroupNotificationPreferences: { notifications: grpNotif,   unreads: grpUnreads },
        defaultGuildNotificationPreferences: { notifications: gldNotif,   unreads: gldUnreads },
        notificationsWhileOnline: notifsWhileOnline,
      });
      setSaveStatus('saved');
      clearTimeout(saveStatusTimerRef.current);
      saveStatusTimerRef.current = setTimeout(() => setSaveStatus(null), 2000);
    }, 500);
    return () => clearTimeout(t);
  }, [dmNotif, dmUnreads, grpNotif, grpUnreads, gldNotif, gldUnreads, notifsWhileOnline]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '1.5rem 1.75rem' }}>

      {/* ── Auto-save status indicator ─────────────────────── */}
      <div style={{
        height: '1.4rem', marginBottom: '0.75rem',
        display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
      }}>
        {saveStatus === 'saving' && (
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>
            Saving…
          </span>
        )}
        {saveStatus === 'saved' && (
          <span style={{ fontSize: '0.75rem', color: 'var(--success)', fontWeight: 600 }}>
            ✓ Saved
          </span>
        )}
      </div>

      {/* ── Push Notifications ─────────────────────────────── */}
      <div style={{
        fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-muted)',
        textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '1rem',
        paddingBottom: '0.4rem', borderBottom: '1px solid var(--border)',
      }}>
        Push Notifications
      </div>

      {!pushSupported ? (
        <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '1.75rem', lineHeight: 1.5 }}>
          ⚠️ Your browser does not support Web Push notifications.
        </div>
      ) : getPushUnsupportedReason() ? (
        <div style={{ marginBottom: '1.75rem' }}>
          <div style={{ fontSize: '0.78rem', color: 'var(--danger)', lineHeight: 1.6, marginBottom: '0.4rem' }}>
            ⚠️ Push notifications are not available in this environment:
          </div>
          <pre style={{
            margin: 0, padding: '0.5rem 0.65rem',
            background: 'var(--bg-secondary)', borderRadius: 6,
            fontFamily: 'monospace', fontSize: '0.72rem',
            whiteSpace: 'pre-wrap', wordBreak: 'break-word',
            color: 'var(--text-muted)', border: '1px solid var(--border)',
          }}>{getPushUnsupportedReason()}</pre>
        </div>
      ) : (
        <div style={{ marginBottom: '1.75rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '0.5rem' }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.2rem' }}>
                Browser push notifications
              </div>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>
                {pushEnabled
                  ? 'You will receive push notifications even when the tab is closed.'
                  : 'Enable to receive notifications when the app is in the background.'}
              </div>
            </div>
            {/* Toggle switch */}
            <button
              onClick={handlePushToggle}
              disabled={pushPending || getPermissionState() === 'denied'}
              title={getPermissionState() === 'denied' ? 'Notifications are blocked in your browser settings' : undefined}
              style={{
                position: 'relative', flexShrink: 0,
                width: 44, height: 24, borderRadius: 12, border: 'none',
                background: pushEnabled ? 'var(--accent)' : 'var(--bg-active)',
                cursor: (pushPending || getPermissionState() === 'denied') ? 'not-allowed' : 'pointer',
                opacity: pushPending ? 0.6 : 1,
                transition: 'background 0.2s',
              }}
            >
              <div style={{
                position: 'absolute', top: 3, left: pushEnabled ? 23 : 3,
                width: 18, height: 18, borderRadius: '50%', background: '#fff',
                transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.4)',
              }} />
            </button>
          </div>
          {pushStatus.outcome === 'denied' && (
            <div style={{ fontSize: '0.78rem', color: 'var(--danger)', lineHeight: 1.5 }}>
              ❌ {pushStatus.message || 'Notification permission was denied. Please allow notifications in your browser settings and try again.'}
            </div>
          )}
          {pushStatus.outcome === 'error' && (
            <div style={{ fontSize: '0.78rem', color: 'var(--danger)', lineHeight: 1.6 }}>
              <div style={{ marginBottom: '0.3rem' }}>❌ Failed to enable push notifications:</div>
              <pre style={{
                margin: 0, padding: '0.5rem 0.65rem',
                background: 'var(--bg-secondary)', borderRadius: 6,
                fontFamily: 'monospace', fontSize: '0.72rem',
                whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                color: 'var(--danger)', border: '1px solid var(--border)',
              }}>{pushStatus.message}</pre>
            </div>
          )}
          {pushStatus.outcome === 'granted' && (
            <div style={{ fontSize: '0.78rem', color: 'var(--success)', lineHeight: 1.5 }}>
              ✓ Push notifications enabled!
            </div>
          )}
          {getPermissionState() === 'denied' && (
            <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>
              Notifications are blocked by your browser. Open your browser's site settings to allow them.
            </div>
          )}
        </div>
      )}

      {/* ── Notifications While Online ─────────────────── */}
      <div style={{
        fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-muted)',
        textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '1rem',
        paddingBottom: '0.4rem', borderBottom: '1px solid var(--border)',
      }}>
        Online Behaviour
      </div>

      <div style={{ marginBottom: '1.75rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.2rem' }}>
              Receive notifications while online
            </div>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>
              When enabled, push notifications are sent even if you are currently active in the app.
              Disable to suppress push notifications while you have a session open.
            </div>
          </div>
          <button
            onClick={() => setNotifsWhileOnline(v => !v)}
            style={{
              position: 'relative', flexShrink: 0,
              width: 44, height: 24, borderRadius: 12, border: 'none',
              background: notifsWhileOnline ? 'var(--accent)' : 'var(--bg-active)',
              cursor: 'pointer',
              transition: 'background 0.2s',
            }}
          >
            <div style={{
              position: 'absolute', top: 3, left: notifsWhileOnline ? 23 : 3,
              width: 18, height: 18, borderRadius: '50%', background: '#fff',
              transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.4)',
            }} />
          </button>
        </div>
      </div>

      {/* ── Default notification prefs ─────────────────────── */}
      <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '1.5rem', lineHeight: 1.6 }}>
        These are your <strong style={{ color: 'var(--text-secondary)' }}>default</strong> notification preferences.
        They apply to all channels unless overridden at the guild or channel level.
      </div>

      <NotifPrefsSection
        title="Direct Messages"
        description="Applied to all DM conversations."
        notifValue={dmNotif}
        unreadsValue={dmUnreads}
        onNotifChange={setDmNotif}
        onUnreadsChange={setDmUnreads}
      />

      <NotifPrefsSection
        title="Group Chats"
        description="Applied to all group chats."
        notifValue={grpNotif}
        unreadsValue={grpUnreads}
        onNotifChange={setGrpNotif}
        onUnreadsChange={setGrpUnreads}
      />

      <NotifPrefsSection
        title="Guilds / Servers"
        description="Applied to all guild channels unless the guild or channel overrides it."
        notifValue={gldNotif}
        unreadsValue={gldUnreads}
        onNotifChange={setGldNotif}
        onUnreadsChange={setGldUnreads}
      />

    </div>
  );
}

// ─── Settings Modal ───────────────────────────────────────────────────────────

const TABS = [
  { id: 'profile',       icon: '👤', label: 'Profile',       section: 'MY ACCOUNT' },
  { id: 'appearance',    icon: '🎨', label: 'Appearance',    section: 'APP SETTINGS' },
  { id: 'chat',          icon: '💬', label: 'Chat',          section: 'APP SETTINGS' },
  { id: 'notifications', icon: '🔔', label: 'Notifications', section: 'APP SETTINGS' },
];

const SECTIONS = [...new Set(TABS.map(t => t.section))];

export default function SettingsModal({ onClose }) {
  const [activeTab, setActiveTab] = useState('profile');
  const backdropRef = useRef(null);
  const { isMobile } = useMobile();

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return createPortal(
    <div
      ref={backdropRef}
      onClick={e => { if (e.target === backdropRef.current) onClose(); }}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(0,0,0,0.7)',
        display: 'flex', alignItems: isMobile ? 'stretch' : 'center', justifyContent: isMobile ? 'stretch' : 'center',
      }}
    >
      <div style={{
        background: 'var(--bg-overlay)', border: isMobile ? 'none' : '1px solid var(--border)',
        borderRadius: isMobile ? 0 : 10,
        width: isMobile ? '100%' : 860,
        maxWidth: isMobile ? '100%' : '96vw',
        height: isMobile ? '100%' : 'auto',
        maxHeight: isMobile ? '100%' : '88vh',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
        boxShadow: '0 16px 48px rgba(0,0,0,0.6)',
      }}>
        {/* ── Header ── */}
        <div style={{
          display: 'flex', alignItems: 'center', padding: '1rem 1.25rem',
          borderBottom: '1px solid var(--border)', flexShrink: 0,
        }}>
          <span style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)', flex: 1 }}>
            ⚙️ Settings
          </span>
          <button
            onClick={onClose}
            style={{
              background: 'none', border: 'none', color: 'var(--text-muted)',
              fontSize: '1.2rem', cursor: 'pointer', lineHeight: 1, padding: '0.1rem 0.3rem',
              borderRadius: 4,
            }}
          >✕</button>
        </div>

        {/* ── Body ── */}
        <div style={{ display: 'flex', flex: 1, overflow: 'hidden', flexDirection: isMobile ? 'column' : 'row' }}>
          {/* Left (desktop) / Top (mobile): tab navigation */}
          <div style={{
            width: isMobile ? '100%' : 180,
            flexShrink: 0,
            borderRight: isMobile ? 'none' : '1px solid var(--border)',
            borderBottom: isMobile ? '1px solid var(--border)' : 'none',
            overflowY: isMobile ? 'hidden' : 'auto',
            overflowX: isMobile ? 'auto' : 'hidden',
            padding: isMobile ? '0.5rem' : '1rem 0.5rem',
            display: 'flex', flexDirection: isMobile ? 'row' : 'column', gap: '0.1rem',
            flexWrap: isMobile ? 'nowrap' : 'nowrap',
          }}>
            {SECTIONS.map((section, idx) => (
              <div key={section} style={{ paddingTop: idx > 0 ? '0.75rem' : '0' }}>
                {!isMobile && (
                  <div style={{
                    fontSize: '0.65rem', fontWeight: 700, color: 'var(--text-muted)',
                    textTransform: 'uppercase', letterSpacing: '0.08em',
                    padding: '0 0.6rem 0.4rem',
                  }}>
                    {section}
                  </div>
                )}
                {TABS.filter(t => t.section === section).map(tab => (
                  <TabButton
                    key={tab.id}
                    icon={tab.icon}
                    label={tab.label}
                    active={activeTab === tab.id}
                    onClick={() => setActiveTab(tab.id)}
                  />
                ))}
              </div>
            ))}
          </div>

          {/* Right: tab content */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            {activeTab === 'profile'       && <ProfileTab />}
            {activeTab === 'appearance'    && <AppearanceTab />}
            {activeTab === 'chat'          && <ChatTab />}
            {activeTab === 'notifications' && <NotificationsTab />}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

function TabButton({ icon, label, active, onClick }) {
  const [hov, setHov] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: '0.55rem',
        width: '100%', padding: '0.5rem 0.6rem', border: 'none', borderRadius: 6,
        background: active ? 'var(--bg-active)' : hov ? 'var(--bg-hover)' : 'transparent',
        color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
        fontSize: '0.875rem', fontWeight: active ? 600 : 400,
        cursor: 'pointer', textAlign: 'left', transition: 'background 0.1s, color 0.1s',
      }}
    >
      <span style={{ fontSize: '1rem', lineHeight: 1 }}>{icon}</span>
      {label}
    </button>
  );
}
