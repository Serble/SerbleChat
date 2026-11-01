import { useState, useEffect } from 'react';
import {
  getNtfySubscriptions, createNtfySubscription, updateNtfySubscription,
  deleteNtfySubscription, testNtfySubscription,
} from '../../api.js';
import {
  Button, IconButton, TextInput, Toggle, ErrorBox, Field, Card, Hint, List, ListRow,
  ToggleRow, SectionTitle, useConfirm,
} from '../ui/index.js';
import { BellIcon, CheckIcon, EditIcon, PlusIcon, RefreshIcon, TrashIcon, WarningIcon, XCircleIcon } from '../../icons.jsx';

const DEFAULT_SERVER = 'https://ntfy.sh';
const TOPIC_RE = /^[-_A-Za-z0-9]{1,64}$/;

/** A topic name nobody will guess. Topics on public servers are readable by anyone who knows the name. */
function randomTopic() {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = crypto.getRandomValues(new Uint8Array(20));
  return 'serblechat-' + Array.from(bytes, b => alphabet[b % alphabet.length]).join('');
}

function hostOf(url) {
  try { return new URL(url).host.toLowerCase(); } catch { return ''; }
}

/** "https://ntfy.sh/" + "abc" -> "ntfy.sh/abc" */
function displayName(sub) {
  try {
    const u = new URL(sub.serverUrl);
    return `${u.host}${u.pathname.replace(/\/$/, '')}/${sub.topic}`;
  } catch {
    return sub.topic;
  }
}

function topicUrl(sub) {
  return sub.serverUrl.replace(/\/?$/, '/') + sub.topic;
}

function timeAgo(iso) {
  if (!iso) return null;
  const seconds = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const units = [['day', 86400], ['hour', 3600], ['minute', 60]];
  for (const [name, size] of units) {
    if (seconds >= size) {
      const n = Math.floor(seconds / size);
      return `${n} ${name}${n === 1 ? '' : 's'} ago`;
    }
  }
  return 'just now';
}

/** The latest of success/failure decides what the row says. */
function statusLine(sub) {
  const failedLast = sub.lastFailureAt && (!sub.lastSuccessAt || sub.lastFailureAt > sub.lastSuccessAt);
  if (!sub.enabled) {
    // could have been switched off by hand or automatically after failures; either way, say why it last failed
    return failedLast
      ? { tone: 'danger', text: `Off. Last attempt failed: ${sub.lastError ?? 'unknown error'}` }
      : { tone: 'muted', text: 'Off' };
  }
  if (failedLast) return { tone: 'danger', text: `Last attempt failed: ${sub.lastError ?? 'unknown error'}` };
  if (sub.lastSuccessAt) return { tone: 'muted', text: `Last delivered ${timeAgo(sub.lastSuccessAt)}` };
  return { tone: 'muted', text: 'Nothing sent yet' };
}

// ─── Add / edit form ──────────────────────────────────────────────────────────

function NtfyEditor({ existing, onSaved, onCancel }) {
  const [serverUrl, setServerUrl] = useState(existing?.serverUrl.replace(/\/$/, '') ?? DEFAULT_SERVER);
  const [topic, setTopic] = useState(existing?.topic ?? randomTopic);
  const [token, setToken] = useState('');
  const [removeToken, setRemoveToken] = useState(false);
  const [includeContent, setIncludeContent] = useState(existing?.includeContent ?? false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const hasSavedToken = existing?.hasAccessToken && !removeToken;
  const willHaveToken = token.trim() !== '' || hasSavedToken;
  const topicInvalid = topic !== '' && !TOPIC_RE.test(topic);
  const isNtfySh = hostOf(serverUrl) === 'ntfy.sh';

  async function handleSave(e) {
    e.preventDefault();
    if (saving) return;
    setSaving(true); setError(null);
    try {
      let saved;
      if (existing) {
        const body = { includeContent };
        if (serverUrl.trim() !== existing.serverUrl.replace(/\/$/, '')) body.serverUrl = serverUrl.trim();
        if (topic.trim() !== existing.topic) body.topic = topic.trim();
        if (token.trim()) body.accessToken = token.trim();
        else if (removeToken) body.accessToken = '';
        saved = await updateNtfySubscription(existing.id, body);
      } else {
        saved = await createNtfySubscription({
          serverUrl: serverUrl.trim(), topic: topic.trim(),
          accessToken: token.trim() || null, includeContent,
        });
      }
      onSaved(saved, !existing);
    } catch (err) {
      setError(err.message || 'Failed to save');
      setSaving(false);
    }
  }

  return (
    <Card style={{ marginTop: '0.75rem' }}>
      <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <div style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-primary)' }}>
          {existing ? 'Edit ntfy topic' : 'Add ntfy topic'}
        </div>

        <Field label="Server" hint="ntfy.sh, or the URL of your own ntfy server.">
          <TextInput
            value={serverUrl}
            onChange={e => setServerUrl(e.target.value)}
            placeholder={DEFAULT_SERVER}
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            required
          />
        </Field>

        <Field
          label="Topic"
          error={topicInvalid ? 'Letters, numbers, - and _ only, up to 64 characters.' : null}
          hint="Anyone who knows the topic can read it, unless your server restricts access. Pick something hard to guess."
        >
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <TextInput
              mono
              value={topic}
              onChange={e => setTopic(e.target.value)}
              maxLength={64}
              autoComplete="off"
              spellCheck={false}
              aria-invalid={topicInvalid}
              style={{ flex: 1, minWidth: 0, ...(topicInvalid ? { borderColor: 'var(--danger)' } : null) }}
              required
            />
            <Button onClick={() => setTopic(randomTopic())} title="Generate a random topic name">
              <RefreshIcon size={13} /> Randomise
            </Button>
          </div>
        </Field>

        <Field
          label="Access token (optional)"
          hint={hasSavedToken
            ? <>A token is saved. Enter a new one to replace it, or <button type="button" className="ntfy-link-btn" onClick={() => setRemoveToken(true)}>remove it</button>.</>
            : removeToken
              ? <>The saved token will be removed. <button type="button" className="ntfy-link-btn" onClick={() => setRemoveToken(false)}>Keep it</button></>
              : <>A <code>tk_…</code> token from your ntfy account, for protected topics.</>}
        >
          <TextInput
            mono
            type="password"
            value={token}
            onChange={e => setToken(e.target.value)}
            placeholder={hasSavedToken ? '••••••••••••' : 'tk_…'}
            maxLength={255}
            autoComplete="off"
          />
        </Field>

        {isNtfySh && !willHaveToken && (
          <div className="ntfy-warning">
            <WarningIcon size={14} />
            <span>
              Without an access token, everyone on this Serble Chat server shares one ntfy.sh rate limit, so
              notifications can be delayed or dropped when it's busy. Add a token from a ntfy.sh account to
              use your own limit.
            </span>
          </div>
        )}

        <ToggleRow
          title="Include message content"
          description="ntfy messages aren't end-to-end encrypted, so whoever runs the ntfy server can read them. When this is off, notifications only say who messaged you and where."
          checked={includeContent}
          onChange={setIncludeContent}
        />

        <ErrorBox>{error}</ErrorBox>

        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', marginTop: '-0.5rem' }}>
          <Button variant="ghost" onClick={onCancel} disabled={saving}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={saving || topicInvalid || !topic.trim() || !serverUrl.trim()}>
            {saving ? 'Saving…' : existing ? 'Save' : 'Add'}
          </Button>
        </div>
      </form>
    </Card>
  );
}

// ─── Section ──────────────────────────────────────────────────────────────────

export default function NtfySection() {
  const [subs, setSubs] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [editing, setEditing] = useState(null);       // null | 'new' | subscription id
  const [testing, setTesting] = useState({});         // id -> true while a test is in flight
  const [testResult, setTestResult] = useState({});   // id -> { success, error }
  const [confirm, confirmDialog] = useConfirm();

  useEffect(() => {
    getNtfySubscriptions().then(setSubs).catch(err => setLoadError(err.message || 'Failed to load'));
  }, []);

  function replace(sub) {
    setSubs(prev => prev.some(s => s.id === sub.id) ? prev.map(s => s.id === sub.id ? sub : s) : [...prev, sub]);
  }

  async function runTest(id) {
    setTesting(t => ({ ...t, [id]: true }));
    setTestResult(r => ({ ...r, [id]: null }));
    try {
      const result = await testNtfySubscription(id);
      setTestResult(r => ({ ...r, [id]: result }));
    } catch (err) {
      setTestResult(r => ({ ...r, [id]: { success: false, error: err.message } }));
    } finally {
      setTesting(t => ({ ...t, [id]: false }));
      // the test updates last-success/failure (and may re-enable it), so pick that up
      getNtfySubscriptions().then(setSubs).catch(() => {});
    }
  }

  function handleSaved(sub, created) {
    replace(sub);
    setEditing(null);
    if (created) runTest(sub.id);  // a new topic gets a test straight away so problems show up now
  }

  async function toggleEnabled(sub, enabled) {
    setTestResult(r => ({ ...r, [sub.id]: null }));
    replace({ ...sub, enabled });
    try {
      replace(await updateNtfySubscription(sub.id, { enabled }));
    } catch {
      replace(sub);
    }
  }

  function handleDelete(sub) {
    confirm({
      title: 'Remove ntfy topic',
      message: <>Stop sending notifications to <strong style={{ color: 'var(--text-primary)' }}>{displayName(sub)}</strong>?</>,
      confirmLabel: 'Remove',
      busyLabel: 'Removing…',
      onConfirm: async () => {
        await deleteNtfySubscription(sub.id);
        setSubs(prev => prev.filter(s => s.id !== sub.id));
        if (editing === sub.id) setEditing(null);
      },
    });
  }

  const addButton = editing !== 'new' && (
    <Button size="sm" variant="outline" onClick={() => setEditing('new')}>
      <PlusIcon size={12} /> Add topic
    </Button>
  );

  return (
    <>
      <SectionTitle action={subs?.length > 0 ? addButton : null}>ntfy</SectionTitle>
      <Hint style={{ marginTop: '-0.6rem', marginBottom: '0.85rem' }}>
        Send notifications to a <a href="https://ntfy.sh" target="_blank" rel="noreferrer" className="ntfy-link">ntfy</a> topic, then
        subscribe to it in the ntfy app on your phone or computer. Follows the same notification settings as push.
      </Hint>

      {loadError && <ErrorBox>{`Couldn't load ntfy topics: ${loadError}`}</ErrorBox>}

      {subs?.length > 0 && (
        <List>
          {subs.map(sub => {
            const status = statusLine(sub);
            const test = testResult[sub.id];
            return (
              <ListRow
                key={sub.id}
                leading={<BellIcon size={16} style={{ color: sub.enabled ? 'var(--accent)' : 'var(--text-subtle)', flexShrink: 0 }} />}
                title={<a href={topicUrl(sub)} target="_blank" rel="noreferrer" className="ntfy-topic-link" title="Open this topic in ntfy's web app">{displayName(sub)}</a>}
                subtitle={
                  <span className="ntfy-status">
                    {testing[sub.id]
                      ? 'Sending test…'
                      : test
                        ? test.success
                          ? <span style={{ color: 'var(--success)' }}><CheckIcon size={10} /> Test sent. Check your ntfy app.</span>
                          : <span style={{ color: 'var(--danger)' }}><XCircleIcon size={10} /> Test failed: {test.error}</span>
                        : <span style={{ color: status.tone === 'danger' ? 'var(--danger)' : undefined }}>{status.text}</span>}
                    {!sub.includeContent && !testing[sub.id] && !test && <> · content hidden</>}
                  </span>
                }
                actions={<>
                  <Button size="sm" onClick={() => runTest(sub.id)} disabled={testing[sub.id]}>Test</Button>
                  <IconButton title="Edit" onClick={() => setEditing(editing === sub.id ? null : sub.id)}><EditIcon size={14} /></IconButton>
                  <IconButton title="Remove" onClick={() => handleDelete(sub)}><TrashIcon size={14} /></IconButton>
                  <Toggle checked={sub.enabled} onChange={v => toggleEnabled(sub, v)} title={sub.enabled ? 'Turn off' : 'Turn on'} />
                </>}
              />
            );
          })}
        </List>
      )}

      {subs?.length === 0 && editing !== 'new' && (
        <Button variant="outline" onClick={() => setEditing('new')}>
          <PlusIcon size={13} /> Add ntfy topic
        </Button>
      )}

      {editing != null && (
        <NtfyEditor
          key={editing}
          existing={editing === 'new' ? null : subs.find(s => s.id === editing)}
          onSaved={handleSaved}
          onCancel={() => setEditing(null)}
        />
      )}

      {confirmDialog}
    </>
  );
}
