import { useState, useEffect, useRef } from 'react';
import { useTheme, THEME_PROPS } from '../context/ThemeContext.jsx';
import { useClientOptions } from '../context/ClientOptionsContext.jsx';
import { useApp } from '../context/AppContext.jsx';

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
            onMouseEnter={e => e.currentTarget.style.color = 'var(--danger)'}
            onMouseLeave={e => e.currentTarget.style.color = 'var(--text-subtle)'}
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

      {/* Two-panel body */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* Left: theme list */}
        <div style={{
          width: 190, flexShrink: 0, borderRight: '1px solid var(--border)',
          overflowY: 'auto', padding: '0.75rem 0.5rem',
          display: 'flex', flexDirection: 'column', gap: '0.2rem',
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
              onMouseEnter={e => { e.currentTarget.style.color = 'var(--text-secondary)'; e.currentTarget.style.borderColor = 'var(--text-muted)'; }}
              onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-muted)'; e.currentTarget.style.borderColor = 'var(--border)'; }}
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
              onMouseEnter={e => { e.currentTarget.style.color = 'var(--text-secondary)'; e.currentTarget.style.borderColor = 'var(--text-muted)'; }}
              onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-muted)'; e.currentTarget.style.borderColor = 'var(--border)'; }}
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
          onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-hover)'}
          onMouseLeave={e => e.currentTarget.style.background = 'var(--bg-active)'}
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
          onMouseEnter={e => e.currentTarget.style.background = 'var(--accent-hover)'}
          onMouseLeave={e => e.currentTarget.style.background = 'var(--accent)'}
        >
          {isBuiltIn ? 'Save as Custom & Apply' : 'Save & Apply'}
        </button>
      </div>
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
                onMouseEnter={e => { if (!active) e.currentTarget.style.background = 'var(--bg-hover)'; }}
                onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'var(--bg-secondary)'; }}
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
              onMouseEnter={e => { if (!active) e.currentTarget.style.background = 'var(--bg-hover)'; }}
              onMouseLeave={e => { if (!active) e.currentTarget.style.background = active ? 'rgba(124,58,237,0.08)' : 'var(--bg-secondary)'; }}
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
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
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
  const [saving, setSaving] = useState(false);
  const [saved, setSaved]   = useState(false);

  // Local draft state mirroring currentUser prefs
  const [dmNotif,    setDmNotif]    = useState(currentUser?.defaultDmNotificationPreferences?.notifications    ?? 1);
  const [dmUnreads,  setDmUnreads]  = useState(currentUser?.defaultDmNotificationPreferences?.unreads          ?? 1);
  const [grpNotif,   setGrpNotif]   = useState(currentUser?.defaultGroupNotificationPreferences?.notifications ?? 2);
  const [grpUnreads, setGrpUnreads] = useState(currentUser?.defaultGroupNotificationPreferences?.unreads       ?? 1);
  const [gldNotif,   setGldNotif]   = useState(currentUser?.defaultGuildNotificationPreferences?.notifications ?? 2);
  const [gldUnreads, setGldUnreads] = useState(currentUser?.defaultGuildNotificationPreferences?.unreads       ?? 1);

  // Sync drafts if currentUser updates (e.g. after initial load)
  useEffect(() => {
    if (!currentUser) return;
    setDmNotif(currentUser.defaultDmNotificationPreferences?.notifications    ?? 1);
    setDmUnreads(currentUser.defaultDmNotificationPreferences?.unreads          ?? 1);
    setGrpNotif(currentUser.defaultGroupNotificationPreferences?.notifications ?? 2);
    setGrpUnreads(currentUser.defaultGroupNotificationPreferences?.unreads       ?? 1);
    setGldNotif(currentUser.defaultGuildNotificationPreferences?.notifications ?? 2);
    setGldUnreads(currentUser.defaultGuildNotificationPreferences?.unreads       ?? 1);
  }, [currentUser?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleSave() {
    if (saving) return;
    setSaving(true);
    await updateUserDefaultPrefs({
      defaultDmNotificationPreferences:    { notifications: dmNotif,    unreads: dmUnreads },
      defaultGroupNotificationPreferences: { notifications: grpNotif,   unreads: grpUnreads },
      defaultGuildNotificationPreferences: { notifications: gldNotif,   unreads: gldUnreads },
    });
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '1.5rem 1.75rem' }}>
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

      <button
        onClick={handleSave}
        disabled={saving}
        style={{
          background: saved ? 'var(--success)' : 'var(--accent)',
          border: 'none', borderRadius: 6, padding: '0.6rem 1.5rem',
          color: '#fff', fontSize: '0.9rem', fontWeight: 600,
          cursor: saving ? 'default' : 'pointer', opacity: saving ? 0.7 : 1,
          transition: 'background 0.2s',
        }}
      >
        {saving ? 'Saving…' : saved ? '✓ Saved!' : 'Save Defaults'}
      </button>
    </div>
  );
}

// ─── Settings Modal ───────────────────────────────────────────────────────────

const TABS = [
  { id: 'appearance',    icon: '🎨', label: 'Appearance',    section: 'APP SETTINGS' },
  { id: 'chat',          icon: '💬', label: 'Chat',          section: 'APP SETTINGS' },
  { id: 'notifications', icon: '🔔', label: 'Notifications', section: 'APP SETTINGS' },
];

const SECTIONS = [...new Set(TABS.map(t => t.section))];

export default function SettingsModal({ onClose }) {
  const [activeTab, setActiveTab] = useState('appearance');
  const backdropRef = useRef(null);

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

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
      <div style={{
        background: 'var(--bg-overlay)', border: '1px solid var(--border)',
        borderRadius: 10, width: 860, maxWidth: '96vw', maxHeight: '88vh',
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
        <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
          {/* Left: tab navigation */}
          <div style={{
            width: 140, flexShrink: 0, borderRight: '1px solid var(--border)',
            overflowY: 'auto', padding: '1rem 0.5rem',
            display: 'flex', flexDirection: 'column', gap: '0.1rem',
          }}>
            {SECTIONS.map(section => (
              <div key={section}>
                <div style={{
                  fontSize: '0.65rem', fontWeight: 700, color: 'var(--text-muted)',
                  textTransform: 'uppercase', letterSpacing: '0.08em',
                  padding: '0 0.6rem 0.4rem',
                }}>
                  {section}
                </div>
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
            {activeTab === 'appearance'    && <AppearanceTab />}
            {activeTab === 'chat'          && <ChatTab />}
            {activeTab === 'notifications' && <NotificationsTab />}
          </div>
        </div>
      </div>
    </div>
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
