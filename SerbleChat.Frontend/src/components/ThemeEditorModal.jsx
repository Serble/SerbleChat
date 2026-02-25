import { useState, useEffect, useRef } from 'react';
import { useTheme, THEME_PROPS } from '../context/ThemeContext.jsx';

// Group THEME_PROPS by their group field
const GROUPS = [...new Set(THEME_PROPS.map(p => p.group))];

function groupedProps() {
  const map = {};
  for (const g of GROUPS) map[g] = THEME_PROPS.filter(p => p.group === g);
  return map;
}

function ColorRow({ label, value, onChange }) {
  const [localVal, setLocalVal] = useState(value);

  // Sync if parent value changes (e.g. switching themes)
  useEffect(() => { setLocalVal(value); }, [value]);

  function handleText(e) {
    const v = e.target.value;
    setLocalVal(v);
    // Only propagate valid hex colours
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
      <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)', flex: 1 }}>
        {label}
      </span>
    </div>
  );
}

export default function ThemeEditorModal({ onClose }) {
  const { allThemes, activeTheme, activeId, activateTheme, createTheme, updateTheme, deleteTheme } = useTheme();
  const backdropRef = useRef(null);
  const importInputRef = useRef(null);
  const [importError, setImportError] = useState(null);

  // Working copy of colors for the selected theme in the editor
  const [editingId, setEditingId] = useState(activeId);
  const editingTheme = allThemes.find(t => t.id === editingId) ?? allThemes[0];
  const [draftColors, setDraftColors] = useState({ ...editingTheme.colors });
  const [draftName, setDraftName] = useState(editingTheme.name);

  // When user picks a different theme in the list, update draft
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
      // Create a new custom theme based on the built-in with edited colors
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
    // Reset so the same file can be re-imported if needed
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

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const groups = groupedProps();
  const isBuiltIn = editingTheme.builtIn;

  return (
    <div
      ref={backdropRef}
      onClick={e => { if (e.target === backdropRef.current) onClose(); }}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(0,0,0,0.7)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      {/* Hidden file input for import */}
      <input
        ref={importInputRef}
        type="file"
        accept=".json,application/json"
        style={{ display: 'none' }}
        onChange={handleImportFile}
      />

      <div style={{
        background: 'var(--bg-overlay)', border: '1px solid var(--border)',
        borderRadius: 10, width: 700, maxWidth: '96vw', maxHeight: '88vh',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
        boxShadow: '0 16px 48px rgba(0,0,0,0.6)',
      }}>

        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', padding: '1rem 1.25rem',
          borderBottom: '1px solid var(--border)', flexShrink: 0,
        }}>
          <span style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)', flex: 1 }}>
            🎨 Themes
          </span>
          <button onClick={onClose} style={{
            background: 'none', border: 'none', color: 'var(--text-muted)',
            fontSize: '1.2rem', cursor: 'pointer', lineHeight: 1, padding: '0.1rem 0.3rem',
            borderRadius: 4,
          }}>✕</button>
        </div>

        <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>

          {/* ── Left: theme list ─────────────────────────────────── */}
          <div style={{
            width: 190, flexShrink: 0, borderRight: '1px solid var(--border)',
            overflowY: 'auto', padding: '0.75rem 0.5rem', display: 'flex', flexDirection: 'column', gap: '0.2rem',
          }}>
            <div style={{ fontSize: '0.68rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', padding: '0 0.5rem 0.5rem' }}>
              Built-in
            </div>
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

            <div style={{ fontSize: '0.68rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', padding: '0.75rem 0.5rem 0.5rem' }}>
              Custom
            </div>
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

            {/* Bottom actions */}
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
          </div>

          {/* ── Right: editor ────────────────────────────────────── */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '1rem 1.25rem' }}>

            {/* Name row */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.25rem' }}>
              <input
                value={draftName}
                onChange={e => setDraftName(e.target.value)}
                disabled={isBuiltIn}
                placeholder="Theme name"
                style={{
                  flex: 1, background: isBuiltIn ? 'transparent' : 'var(--bg-input)',
                  border: isBuiltIn ? 'none' : '1px solid var(--border)',
                  borderRadius: 4, color: 'var(--text-primary)',
                  fontSize: '1rem', fontWeight: 700, padding: isBuiltIn ? 0 : '0.35rem 0.6rem',
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
          display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.6rem',
          padding: '0.75rem 1.25rem', borderTop: '1px solid var(--border)', flexShrink: 0,
        }}>
          {/* Export button on the left */}
          <button
            onClick={handleExport}
            title="Export current theme as JSON"
            style={{
              background: 'var(--bg-active)', border: 'none', borderRadius: 6,
              color: 'var(--text-secondary)', padding: '0.45rem 1rem', fontSize: '0.875rem',
              cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.35rem',
            }}
            className="hov-bg"
          >
            ⬇ Export JSON
          </button>

          <div style={{ display: 'flex', gap: '0.6rem' }}>
            <button onClick={onClose} style={{
              background: 'var(--bg-active)', border: 'none', borderRadius: 6,
              color: 'var(--text-secondary)', padding: '0.45rem 1rem', fontSize: '0.875rem',
              cursor: 'pointer',
            }}>
              Close
            </button>
            <button onClick={handleApply} style={{
              background: 'var(--accent)', border: 'none', borderRadius: 6,
              color: '#fff', padding: '0.45rem 1rem', fontSize: '0.875rem',
              cursor: 'pointer', fontWeight: 600,
            }}
              className="hov-accent"
            >
              {isBuiltIn ? 'Save as Custom & Apply' : 'Save & Apply'}
            </button>
          </div>
        </div>
      </div>
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
      {/* Color swatch */}
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
        {/* Apply */}
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
        {/* Delete custom only */}
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