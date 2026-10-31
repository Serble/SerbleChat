import { useState, useEffect, useRef } from 'react';
import { useClientOptions } from '../../context/ClientOptionsContext.jsx';
import { isElectron } from '../../electron-utils.js';
import { Button, TextInput, Card, Hint } from '../ui/index.js';
import { WarningIcon } from '../../icons.jsx';
import { TabBody } from './common.jsx';

const KEYBIND_ACTIONS = [
  { key: 'toggleMute',   label: 'Toggle Mute' },
  { key: 'toggleDeafen', label: 'Toggle Deafen' },
  { key: 'pushToTalk',   label: 'Push to Talk' },
];

// KeyboardEvent.key → Electron accelerator key name (where they differ)
const KEY_NAMES = {
  ' ': 'Space',
  ScrollLock: 'ScrLk',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  Enter: 'Return',
};

const MODIFIER_KEYS = new Set(['Control', 'Shift', 'Alt', 'Meta']);
const UNREGISTERABLE_KEYS = ['pause', 'scrolllock', 'numlock', 'capslock'];

function hasUnregisterableKey(keybind) {
  const lower = (keybind ?? '').toLowerCase();
  return UNREGISTERABLE_KEYS.some(k => lower.includes(k));
}

function eventToAccelerator(e) {
  const parts = [];
  if (e.ctrlKey || e.metaKey) parts.push('CommandOrControl');
  if (e.shiftKey) parts.push('Shift');
  if (e.altKey) parts.push('Alt');
  const key = /^F\d+$/i.test(e.key) ? e.key.toUpperCase() : (KEY_NAMES[e.key] ?? e.key);
  return [...parts, key].join('+');
}

function formatKeybind(keybind) {
  if (!keybind) return 'Not set';
  return keybind.split('+')
    .map(part => (part === 'CommandOrControl' || part === 'Control') ? 'Ctrl' : part.length === 1 ? part.toUpperCase() : part)
    .join('+');
}

function KeybindInput({ label, value, onChange }) {
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState(null);
  // Keep the latest onChange without re-binding the key listener every render
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (!recording) return;
    let errorTimer;

    async function handleKeyDown(e) {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') { setRecording(false); return; }
      if (MODIFIER_KEYS.has(e.key)) return; // wait for the actual key

      const accelerator = eventToAccelerator(e);
      if (window.electron?.validateKeybind) {
        const result = await window.electron.validateKeybind(accelerator);
        if (!result.valid) {
          setError(result.error || 'Invalid keybind');
          clearTimeout(errorTimer);
          errorTimer = setTimeout(() => setError(null), 2000);
          return;
        }
      }
      onChangeRef.current(accelerator);
      setRecording(false);
      setError(null);
    }

    function stop() { setRecording(false); }

    // Capture phase so the settings modal's Escape handler doesn't close it mid-record
    window.addEventListener('keydown', handleKeyDown, true);
    window.addEventListener('blur', stop);
    return () => {
      clearTimeout(errorTimer);
      window.removeEventListener('keydown', handleKeyDown, true);
      window.removeEventListener('blur', stop);
    };
  }, [recording]);

  return (
    <div>
      <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '0.4rem', fontWeight: 500 }}>
        {label}
      </div>
      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
        <TextInput
          mono
          readOnly
          value={recording ? 'Press keys…' : formatKeybind(value)}
          onClick={() => { setRecording(true); setError(null); }}
          onBlur={() => setRecording(false)}
          style={{
            flex: 1, cursor: 'pointer',
            background: recording ? 'var(--accent)' : undefined,
            color: recording ? '#fff' : undefined,
            borderColor: error ? 'var(--danger)' : undefined,
          }}
        />
        {value && <Button variant="secondary" onClick={() => onChange('')}>Clear</Button>}
      </div>
      {error && <div style={{ fontSize: '0.75rem', color: 'var(--danger)', marginTop: '0.3rem' }}>{error}</div>}
    </div>
  );
}

export default function KeybindsTab() {
  const { keybinds, setKeybinds } = useClientOptions();
  const [draft, setDraft] = useState(keybinds);

  useEffect(() => { setDraft(keybinds); }, [keybinds]);

  const dirty = KEYBIND_ACTIONS.some(a => (draft[a.key] ?? '') !== (keybinds[a.key] ?? ''));
  const showOsWarning = KEYBIND_ACTIONS.some(a => hasUnregisterableKey(draft[a.key]));

  return (
    <TabBody>
      <h3 style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-primary)', margin: '0 0 0.5rem' }}>
        Keybinds
      </h3>
      <Hint style={{ fontSize: '0.85rem', marginBottom: '1.5rem' }}>
        Configure keyboard shortcuts for voice chat controls.{' '}
        {isElectron()
          ? 'These shortcuts work globally even when the app is not focused.'
          : 'In the web version, these shortcuts only work when SerbleChat is focused. For global shortcuts, use the desktop app.'}
      </Hint>

      <Card style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginBottom: '1.5rem' }}>
        {KEYBIND_ACTIONS.map(a => (
          <KeybindInput
            key={a.key}
            label={a.label}
            value={draft[a.key]}
            onChange={val => setDraft(d => ({ ...d, [a.key]: val }))}
          />
        ))}
      </Card>

      <div style={{ fontSize: '0.75rem', color: 'var(--text-subtle)', lineHeight: 1.6, marginBottom: '1.5rem' }}>
        <strong style={{ color: 'var(--text-muted)' }}>Tips:</strong>
        <ul style={{ margin: '0.5rem 0 0 1.2rem', padding: 0 }}>
          <li>Click on a keybind field and press your desired key combination (Escape cancels)</li>
          <li>Use modifiers like Ctrl/Cmd, Shift, and Alt with letter keys</li>
          <li>Example: Ctrl+Shift+M (Cmd+Shift+M on Mac)</li>
        </ul>
      </div>

      {showOsWarning && (
        <div style={{
          fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.5,
          background: 'color-mix(in srgb, var(--warning) 12%, transparent)', border: '1px solid color-mix(in srgb, var(--warning) 45%, transparent)',
          borderRadius: 6, padding: '0.75rem', marginBottom: '1.5rem',
        }}>
          <strong style={{ color: 'var(--warning)' }}><WarningIcon size={14} /> Warning:</strong> one of these key
          combinations can't be registered as a global shortcut due to OS limitations. The binding will be
          saved but may not work as a global hotkey.
        </div>
      )}

      {dirty && (
        <div style={{ display: 'flex', gap: '0.75rem', paddingTop: '1rem', borderTop: '1px solid var(--border)' }}>
          <Button variant="primary" onClick={() => setKeybinds(draft)}>Save Changes</Button>
          <Button variant="secondary" onClick={() => setDraft(keybinds)}>Reset</Button>
        </div>
      )}
    </TabBody>
  );
}
