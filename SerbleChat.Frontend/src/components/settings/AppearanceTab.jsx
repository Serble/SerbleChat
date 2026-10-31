import { useState, useEffect, useRef } from 'react';
import { useTheme, THEME_PROPS } from '../../context/ThemeContext.jsx';
import { useMobile } from '../../context/MobileContext.jsx';
import { Button, TextInput, Badge } from '../ui/index.js';
import { CheckIcon, TrashIcon, PlusIcon, UploadIcon, DownloadIcon } from '../../icons.jsx';
import { HEX_COLOR_RE } from './common.jsx';

const GROUPS = [...new Set(THEME_PROPS.map(p => p.group))];
const PROPS_BY_GROUP = Object.fromEntries(GROUPS.map(g => [g, THEME_PROPS.filter(p => p.group === g)]));
const VALID_KEYS = new Set(THEME_PROPS.map(p => p.key));

const groupLabelStyle = {
  fontSize: '0.68rem', fontWeight: 700, color: 'var(--text-muted)',
  textTransform: 'uppercase', letterSpacing: '0.07em', padding: '0 0.5rem 0.5rem',
};

function ColorRow({ label, value, onChange }) {
  const [text, setText] = useState(value);
  useEffect(() => { setText(value); }, [value]);

  function handleText(e) {
    const v = e.target.value;
    setText(v);
    if (HEX_COLOR_RE.test(v)) onChange(v);
  }

  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', padding: '0.3rem 0' }}>
      <input
        type="color"
        value={HEX_COLOR_RE.test(text) ? text : '#000000'}
        onChange={e => { setText(e.target.value); onChange(e.target.value); }}
        style={{
          width: 30, height: 30, padding: 2, borderRadius: 6, flexShrink: 0,
          border: '1px solid var(--border)', background: 'var(--bg-input)', cursor: 'pointer',
        }}
      />
      <TextInput
        mono
        value={text}
        onChange={handleText}
        maxLength={7}
        style={{ width: 88, padding: '0.2rem 0.4rem', fontSize: '0.78rem', color: 'var(--text-secondary)' }}
      />
      <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)', flex: 1 }}>{label}</span>
    </label>
  );
}

function ThemeListItem({ theme, active, editing, onSelect, onActivate, onDelete }) {
  return (
    <div
      onClick={onSelect}
      className={editing ? undefined : 'hov-bg'}
      style={{
        display: 'flex', alignItems: 'center', gap: '0.4rem',
        padding: '0.4rem 0.5rem', borderRadius: 6, cursor: 'pointer',
        background: editing ? 'var(--bg-active)' : 'transparent',
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
      <button
        title={active ? 'Active theme' : 'Apply theme'}
        onClick={e => { e.stopPropagation(); onActivate(); }}
        style={{
          display: 'inline-flex', alignItems: 'center', flexShrink: 0,
          background: active ? 'var(--accent)' : 'transparent',
          border: active ? '1px solid transparent' : '1px solid var(--border)',
          borderRadius: 4, color: active ? '#fff' : 'var(--text-muted)',
          fontSize: '0.65rem', padding: '0.1rem 0.3rem', cursor: 'pointer',
        }}
      >
        {active ? <CheckIcon size={10} /> : 'Use'}
      </button>
      {onDelete && (
        <button
          title="Delete theme"
          onClick={e => { e.stopPropagation(); onDelete(); }}
          className="hov-color-danger"
          style={{
            display: 'inline-flex', background: 'transparent', border: 'none', flexShrink: 0,
            color: 'var(--text-subtle)', cursor: 'pointer', padding: '0.1rem 0.2rem', borderRadius: 3,
          }}
        >
          <TrashIcon size={14} />
        </button>
      )}
    </div>
  );
}

export default function AppearanceTab() {
  const { allThemes, activeTheme, activeId, activateTheme, createTheme, updateTheme, deleteTheme } = useTheme();
  const { isMobile } = useMobile();

  const importInputRef = useRef(null);
  const [importError, setImportError] = useState(null);
  const [editingId, setEditingId] = useState(activeId);
  const editingTheme = allThemes.find(t => t.id === editingId) ?? allThemes[0];
  const [draftColors, setDraftColors] = useState({ ...editingTheme.colors });
  const [draftName, setDraftName] = useState(editingTheme.name);

  const builtInThemes = allThemes.filter(t => t.builtIn);
  const customThemes = allThemes.filter(t => !t.builtIn);
  const isBuiltIn = editingTheme.builtIn;

  // Takes the name/colours explicitly because a theme that was *just* created
  // isn't in `allThemes` until the next render.
  function selectForEdit(id, name, colors) {
    const t = allThemes.find(th => th.id === id);
    setEditingId(id);
    setDraftName(name ?? t?.name ?? '');
    setDraftColors({ ...(colors ?? t?.colors) });
  }

  function handleApply() {
    if (isBuiltIn) {
      const name = `${editingTheme.name} (custom)`;
      const newId = createTheme(name, draftColors);
      activateTheme(newId);
      selectForEdit(newId, name, draftColors);
    } else {
      updateTheme(editingId, { name: draftName, colors: draftColors });
      activateTheme(editingId);
    }
  }

  function handleNew() {
    const name = 'My Theme';
    const newId = createTheme(name, activeTheme.colors);
    selectForEdit(newId, name, activeTheme.colors);
  }

  function handleDelete(id) {
    if (!confirm('Delete this theme?')) return;
    deleteTheme(id);
    if (id === editingId) selectForEdit('dark');
  }

  function handleExport() {
    const blob = new Blob([JSON.stringify({ name: draftName, colors: draftColors }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(draftName || 'theme').replace(/[^a-z0-9_-]/gi, '_')}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleImportFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    const reader = new FileReader();
    reader.onload = ev => {
      try {
        const parsed = JSON.parse(ev.target.result);
        if (!parsed || typeof parsed.colors !== 'object') throw new Error('Missing "colors" object');
        const colors = {};
        for (const [k, v] of Object.entries(parsed.colors)) {
          if (VALID_KEYS.has(k) && HEX_COLOR_RE.test(v)) colors[k] = v;
        }
        if (Object.keys(colors).length === 0) throw new Error('No valid colour values found');
        const name = typeof parsed.name === 'string' && parsed.name.trim()
          ? parsed.name.trim()
          : file.name.replace(/\.json$/i, '');
        const merged = { ...activeTheme.colors, ...colors };
        const newId = createTheme(name, merged);
        selectForEdit(newId, name, merged);
        setImportError(null);
      } catch (err) {
        setImportError(`Import failed: ${err.message}`);
      }
    };
    reader.readAsText(file);
  }

  function renderItem(t, deletable) {
    return (
      <ThemeListItem
        key={t.id}
        theme={t}
        active={activeId === t.id}
        editing={editingId === t.id}
        onSelect={() => selectForEdit(t.id)}
        onActivate={() => { activateTheme(t.id); selectForEdit(t.id); }}
        onDelete={deletable ? () => handleDelete(t.id) : undefined}
      />
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <input
        ref={importInputRef}
        type="file"
        accept=".json,application/json"
        style={{ display: 'none' }}
        onChange={handleImportFile}
      />

      <div style={{ display: 'flex', flex: 1, minHeight: 0, flexDirection: isMobile ? 'column' : 'row' }}>
        {/* Theme list */}
        <div style={{
          width: isMobile ? '100%' : 200,
          maxHeight: isMobile ? '35%' : undefined,
          flexShrink: 0,
          borderRight: isMobile ? 'none' : '1px solid var(--border)',
          borderBottom: isMobile ? '1px solid var(--border)' : 'none',
          overflowY: 'auto', padding: '0.75rem 0.5rem',
          display: 'flex', flexDirection: 'column', gap: '0.2rem',
        }}>
          <div style={groupLabelStyle}>Built-in</div>
          {builtInThemes.map(t => renderItem(t, false))}

          <div style={{ ...groupLabelStyle, paddingTop: '0.75rem' }}>Custom</div>
          {customThemes.map(t => renderItem(t, true))}
          {customThemes.length === 0 && (
            <div style={{ fontSize: '0.78rem', color: 'var(--text-subtle)', padding: '0 0.5rem' }}>
              No custom themes yet.
            </div>
          )}

          <div style={{ marginTop: 'auto', paddingTop: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
            <Button variant="outline" onClick={handleNew} style={{ borderStyle: 'dashed' }}>
              <PlusIcon size={14} /> New Theme
            </Button>
            <Button variant="outline" onClick={() => { setImportError(null); importInputRef.current?.click(); }}>
              <UploadIcon size={14} /> Import JSON
            </Button>
            {importError && (
              <div style={{ fontSize: '0.72rem', color: 'var(--danger)', padding: '0 0.25rem', lineHeight: 1.4 }}>
                {importError}
              </div>
            )}
          </div>
        </div>

        {/* Editor */}
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '1rem 1.25rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.25rem' }}>
            {isBuiltIn ? (
              <>
                <span style={{ flex: 1, fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)' }}>{draftName}</span>
                <Badge>Built-in</Badge>
              </>
            ) : (
              <TextInput
                value={draftName}
                onChange={e => setDraftName(e.target.value)}
                placeholder="Theme name"
                style={{ flex: 1, fontSize: '1rem', fontWeight: 700 }}
              />
            )}
          </div>

          {GROUPS.map(group => (
            <div key={group} style={{ marginBottom: '1rem' }}>
              <div style={{ ...groupLabelStyle, padding: 0, marginBottom: '0.4rem' }}>{group}</div>
              <div style={{ background: 'var(--bg-secondary)', borderRadius: 6, padding: '0.5rem 0.75rem' }}>
                {PROPS_BY_GROUP[group].map(prop => (
                  <ColorRow
                    key={prop.key}
                    label={prop.label}
                    value={draftColors[prop.key] ?? '#000000'}
                    onChange={val => setDraftColors(prev => ({ ...prev, [prop.key]: val }))}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem',
        padding: '0.75rem 1.25rem', borderTop: '1px solid var(--border)', flexShrink: 0,
      }}>
        <Button variant="secondary" onClick={handleExport} title="Export current theme as JSON">
          <DownloadIcon size={14} /> Export JSON
        </Button>
        <Button variant="primary" onClick={handleApply}>
          {isBuiltIn ? 'Save as Custom & Apply' : 'Save & Apply'}
        </Button>
      </div>
    </div>
  );
}
