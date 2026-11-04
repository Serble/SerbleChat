import { useState, useEffect, useCallback } from 'react';
import { Button, Card, Hint, SectionTitle, Toggle, EmptyState, ErrorBox, Badge } from '../ui/index.js';
import { PuzzleIcon, WarningIcon, FolderIcon, RefreshIcon } from '../../icons.jsx';
import ModSlot from '../../mods/ModSlot.jsx';
import { rendererStatus, enabledAtLoad } from '../../mods/store.js';
import { TabBody } from './common.jsx';

/** What a mod's doing, from its main half's status and (if it has one) its renderer half's. */
function describeStatus(mod) {
  if (mod.status === 'error') return { label: 'Error', tone: 'danger', error: mod.error };
  if (!mod.enabled) return { label: enabledAtLoad.get(mod.id) ? 'Off after reload' : 'Off', tone: 'muted' };
  if (!enabledAtLoad.get(mod.id)) return { label: 'On after reload', tone: 'muted' };
  const renderer = mod.rendererUrl ? rendererStatus.get(mod.id) : null;
  if (renderer?.status === 'error') return { label: 'Error', tone: 'danger', error: renderer.error };
  return { label: 'Running', tone: 'success' };
}

const TONE_COLORS = { danger: 'var(--danger)', success: 'var(--success)', muted: 'var(--text-muted)' };

function ModCard({ mod, onToggle, busy }) {
  const status = describeStatus(mod);
  const loaded = mod.enabled && enabledAtLoad.get(mod.id) && status.tone !== 'danger';
  return (
    <Card style={{ marginBottom: '0.75rem' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--text-primary)' }}>{mod.name}</span>
            {mod.version && <Badge>{mod.version}</Badge>}
            <span style={{ fontSize: '0.75rem', fontWeight: 600, color: TONE_COLORS[status.tone] }}>{status.label}</span>
          </div>
          {mod.author && <Hint style={{ marginTop: '0.1rem' }}>by {mod.author}</Hint>}
          {mod.description && (
            <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: '0.35rem' }}>{mod.description}</div>
          )}
          <Hint style={{ marginTop: '0.35rem', fontFamily: 'monospace', wordBreak: 'break-all' }}>{mod.dir}</Hint>
        </div>
        <Toggle
          checked={mod.enabled}
          disabled={busy}
          onChange={() => onToggle(mod)}
          title={mod.enabled ? `Turn off ${mod.name}` : `Turn on ${mod.name}`}
        />
      </div>
      {status.error && (
        <ErrorBox style={{ marginTop: '0.6rem' }}>
          <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: '0.75rem' }}>{status.error}</pre>
        </ErrorBox>
      )}
      {loaded && (
        <div style={{ marginTop: '0.25rem' }}>
          <ModSlot name={`settings:${mod.id}`} showErrors />
        </div>
      )}
    </Card>
  );
}

export default function ModsTab() {
  const bridge = window.electron?.mods;
  const [mods, setMods] = useState(null);
  const [folder, setFolder] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    try {
      setMods(await bridge.list());
      setFolder(await bridge.folder());
    } catch (err) {
      setError(err.message ?? String(err));
      setMods([]);
    }
  }, [bridge]);

  useEffect(() => { if (bridge) refresh(); }, [bridge, refresh]);

  async function toggle(mod) {
    setBusy(true);
    try {
      await bridge.setEnabled(mod.id, !mod.enabled);
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function reload() {
    setBusy(true);
    try {
      await bridge.reload();
    } catch (err) {
      console.error('[mods] Reload failed:', err);
    }
    // Loads the renderer halves fresh (and leaves any call: mods may have been part of it)
    window.location.reload();
  }

  if (!bridge) {
    return (
      <TabBody>
        <EmptyState icon={PuzzleIcon} title="Mods need the desktop app">
          Client mods can only be installed in the Serble Chat desktop app.
        </EmptyState>
      </TabBody>
    );
  }

  const needsReload = (mods ?? []).some(m => m.enabled !== !!enabledAtLoad.get(m.id));

  return (
    <TabBody>
      <div className="ntfy-warning" style={{ fontSize: '0.85rem', marginBottom: '1.25rem' }}>
        <WarningIcon size={16} />
        <div>
          Mods run with full access to your computer and your Serble account: they can read your
          messages, files and passwords. Only turn on mods from people you trust.
        </div>
      </div>

      <SectionTitle action={
        <div style={{ display: 'flex', gap: '0.4rem' }}>
          <Button size="sm" onClick={() => bridge.openFolder()} disabled={busy}>
            <FolderIcon size={14} /> Open folder
          </Button>
          <Button size="sm" variant={needsReload ? 'primary' : 'secondary'} onClick={reload} disabled={busy}>
            <RefreshIcon size={14} /> {needsReload ? 'Reload to apply' : 'Reload mods'}
          </Button>
        </div>
      }>
        Installed Mods
      </SectionTitle>

      {error && <ErrorBox style={{ marginBottom: '0.75rem' }}>{error}</ErrorBox>}

      {mods && mods.length === 0 && (
        <EmptyState icon={PuzzleIcon} title="No mods installed">
          Put a mod's folder (one with a mod.json in it) in {folder ? <code style={{ wordBreak: 'break-all' }}>{folder}</code> : 'the mods folder'}, then press Reload mods.
        </EmptyState>
      )}

      {mods?.map(mod => <ModCard key={mod.id} mod={mod} onToggle={toggle} busy={busy} />)}

      {needsReload && (
        <Hint style={{ marginTop: '0.5rem' }}>Mods turn on and off when you reload. Reloading leaves any call you're in.</Hint>
      )}
    </TabBody>
  );
}
