import { useState, useEffect, useRef } from 'react';
import {
  getGuildWebhooks, createGuildWebhook, updateGuildWebhook, deleteGuildWebhook,
  regenerateGuildWebhookToken, uploadGuildWebhookAvatar, deleteGuildWebhookAvatar,
  getGuildChannels, getWebhookUrl, getWebhookAvatarUrl,
} from '../../api.js';
import { copyToClipboard } from '../../electron-utils.js';
import { useMobile } from '../../context/MobileContext.jsx';
import {
  Button, IconButton, TextInput, Select, ErrorBox, Field, SaveStatus, SectionTitle, Hint,
  SplitPane, SplitItem, EmptyState, IconUploadField, TabBody, useConfirm, useFlashStatus,
} from '../ui/index.js';
import Avatar from '../Avatar.jsx';
import { MutedText, DangerZone, DangerRow } from './common.jsx';
import useAutoSave from './useAutoSave.js';
import {
  PlusIcon, TrashIcon, CheckIcon, ClipboardIcon, RefreshIcon, WarningIcon, WebhookIcon,
} from '../../icons.jsx';

const NEW_WEBHOOK_NAME = 'New Webhook';

/** A webhook's own avatar, with `version` busting the cache after an upload. */
function avatarSrc(webhook, version) {
  if (!webhook.hasAvatar) return null;
  const url = getWebhookAvatarUrl(webhook.id);
  return version ? `${url}?t=${version}` : url;
}

/** The URL with the token hidden, so it isn't exposed on a shared screen. */
function maskedUrl(webhook) {
  return getWebhookUrl(webhook).replace(webhook.token, '•'.repeat(12));
}

// ─── Webhook editor ───────────────────────────────────────────────────────────

function WebhookEditor({ guildId, webhook, channels, avatarVersion, autoFocusName, onChange, onAvatarChanged, onDelete }) {
  const nameRef = useRef(null);
  const savedName = useRef(webhook.name);
  const latest = useRef(webhook);
  latest.current = webhook;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const [confirm, confirmDialog] = useConfirm();
  const [copied, flashCopied] = useFlashStatus();
  const [channelStatus, flashChannel, setChannelStatus] = useFlashStatus();
  const [error, setError] = useState(null);

  const { status: nameStatus, error: nameError, schedule } = useAutoSave(async name => {
    await updateGuildWebhook(guildId, webhook.id, { name });
    savedName.current = name;
  }, 700);

  useEffect(() => {
    if (autoFocusName) { nameRef.current?.focus(); nameRef.current?.select(); }
  }, [autoFocusName]);

  // Put the last saved name back if we're left with a blank one
  useEffect(() => () => {
    if (!latest.current.name.trim()) onChangeRef.current({ ...latest.current, name: savedName.current });
  }, []);

  function handleName(value) {
    onChange({ ...webhook, name: value });
    if (value.trim()) schedule(value.trim());
  }

  async function handleChannel(value) {
    const channelId = Number(value);
    const previous = webhook.channelId;
    onChange({ ...webhook, channelId });
    setChannelStatus('saving'); setError(null);
    try {
      await updateGuildWebhook(guildId, webhook.id, { channelId });
      flashChannel('saved', 2000);
    } catch (err) {
      onChange({ ...latest.current, channelId: previous });
      setChannelStatus('error');
      setError(`Couldn't change the channel: ${err.message}`);
    }
  }

  function copyUrl() {
    copyToClipboard(getWebhookUrl(webhook)).catch(err => console.error('Failed to copy webhook URL:', err));
    flashCopied(true, 2000);
  }

  function handleRegenerate() {
    confirm({
      title: 'Regenerate URL',
      message: <>Make a new URL for <strong style={{ color: 'var(--text-primary)' }}>{webhook.name}</strong>? Anything still using the old one will stop being able to post.</>,
      confirmLabel: 'Regenerate',
      busyLabel: 'Regenerating…',
      onConfirm: async () => {
        const updated = await regenerateGuildWebhookToken(guildId, webhook.id);
        onChange({ ...latest.current, token: updated.token });
      },
    });
  }

  const nameEmpty = !webhook.name.trim();
  const channelMissing = webhook.channelId == null || !channels.some(c => c.id === webhook.channelId);
  const status = nameStatus ?? channelStatus;

  return (
    <TabBody>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '1.5rem', minHeight: 30 }}>
        <Avatar key={avatarVersion} src={avatarSrc(webhook, avatarVersion)} name={webhook.name.trim() || savedName.current} size={28} />
        <div style={{ flex: 1, minWidth: 0, fontSize: '1.05rem', fontWeight: 700, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {webhook.name.trim() || savedName.current}
        </div>
        <span title={nameError ?? undefined}><SaveStatus status={status} /></span>
      </div>

      <ErrorBox style={{ marginBottom: '1rem' }}>{error ?? (nameError && `Couldn't save: ${nameError}`)}</ErrorBox>

      <SectionTitle>Webhook URL</SectionTitle>
      <Hint style={{ marginBottom: '0.75rem' }}>
        Anything that can post to a Discord webhook can post here. For Slack-style integrations add <code>/slack</code> to
        the end, and for a GitHub repository's webhook settings add <code>/github</code>. Keep it secret: anyone with the
        URL can post as this webhook.
      </Hint>
      <div className="webhook-url-row">
        <code className="webhook-url" title="Copy the URL to see it in full">{maskedUrl(webhook)}</code>
        <Button size="sm" variant={copied ? 'success' : 'primary'} onClick={copyUrl} style={{ minWidth: 104 }}>
          {copied ? <><CheckIcon size={12} /> Copied</> : <><ClipboardIcon size={12} /> Copy URL</>}
        </Button>
      </div>

      <SectionTitle>Posts To</SectionTitle>
      <Field
        label="Channel"
        hint={channelMissing ? null : 'Changing this moves where new messages go. The URL stays the same.'}
        error={channelMissing ? "This webhook's channel was deleted. Pick a new one or its messages will be rejected." : null}
      >
        <Select
          value={channelMissing ? '' : String(webhook.channelId)}
          onChange={e => handleChannel(e.target.value)}
          aria-invalid={channelMissing}
        >
          {channelMissing && <option value="" disabled>Pick a channel…</option>}
          {channels.map(c => <option key={c.id} value={String(c.id)}># {c.name}</option>)}
        </Select>
      </Field>

      <SectionTitle>Profile</SectionTitle>
      <Hint style={{ marginBottom: '0.9rem' }}>
        The default name and picture for its messages. Requests can override both per message.
      </Hint>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.1rem' }}>
        <Field label="Name" error={nameEmpty ? "Name can't be empty" : null}>
          <TextInput
            ref={nameRef}
            value={webhook.name}
            onChange={e => handleName(e.target.value)}
            maxLength={80}
            aria-invalid={nameEmpty}
            style={nameEmpty ? { borderColor: 'var(--danger)' } : undefined}
          />
        </Field>
        <Field label="Avatar">
          <IconUploadField
            src={avatarSrc(webhook, avatarVersion)}
            fallback={(webhook.name.trim() || savedName.current)[0]?.toUpperCase() ?? '?'}
            alt="Webhook avatar"
            hint="Square images work best."
            size={72}
            onUpload={async file => onAvatarChanged(await uploadGuildWebhookAvatar(guildId, webhook.id, file))}
            onRemove={async () => onAvatarChanged(await deleteGuildWebhookAvatar(guildId, webhook.id))}
          />
        </Field>
      </div>

      <SectionTitle>Danger Zone</SectionTitle>
      <DangerZone>
        <DangerRow
          title="Regenerate URL"
          description="Make a new URL. The old one stops working straight away."
          action={<Button variant="danger-outline" onClick={handleRegenerate}><RefreshIcon size={13} /> Regenerate</Button>}
        />
        <DangerRow
          title="Delete webhook"
          description="Its URL stops working. Messages it already posted stay."
          action={<Button variant="danger" onClick={() => onDelete(webhook)}><TrashIcon size={13} /> Delete</Button>}
        />
      </DangerZone>
      {confirmDialog}
    </TabBody>
  );
}

// ─── Webhooks tab ─────────────────────────────────────────────────────────────

export default function WebhooksTab({ guildId }) {
  const { isMobile } = useMobile();
  const [webhooks, setWebhooks]   = useState([]);
  const [channels, setChannels]   = useState([]);
  const [loading, setLoading]     = useState(true);
  const [loadErr, setLoadErr]     = useState(null);
  const [selected, setSelected]   = useState(null);
  const [justCreated, setJustCreated] = useState(null);
  const [creating, setCreating]   = useState(false);
  const [createErr, setCreateErr] = useState(null);
  const [avatarVersions, setAvatarVersions] = useState({}); // webhook id → cache-busting ts
  const [confirm, confirmDialog]  = useConfirm();

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setLoadErr(null);
    Promise.all([getGuildWebhooks(guildId), getGuildChannels(guildId)])
      .then(([hooks, chans]) => {
        if (cancelled) return;
        setWebhooks(hooks ?? []);
        setChannels(chans ?? []);
        // Open the first webhook straight away rather than an empty "pick one" pane
        if (!isMobile && hooks?.length) setSelected(s => s ?? hooks[0].id);
      })
      .catch(err => { if (!cancelled) setLoadErr(err.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [guildId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleCreate() {
    if (creating) return;
    if (channels.length === 0) { setCreateErr('Create a channel first'); return; }
    setCreating(true); setCreateErr(null);
    try {
      const hook = await createGuildWebhook(guildId, { name: NEW_WEBHOOK_NAME, channelId: channels[0].id });
      setWebhooks(p => [...p, hook]);
      setSelected(hook.id);
      setJustCreated(hook.id);
    } catch (err) { setCreateErr(err.message); }
    finally { setCreating(false); }
  }

  function handleDelete(hook) {
    confirm({
      title: 'Delete Webhook',
      message: <>Delete <strong style={{ color: 'var(--text-primary)' }}>{hook.name}</strong>? Anything using its URL will stop being able to post. This can't be undone.</>,
      confirmLabel: 'Delete Webhook',
      busyLabel: 'Deleting…',
      onConfirm: async () => {
        await deleteGuildWebhook(guildId, hook.id);
        const rest = webhooks.filter(w => w.id !== hook.id);
        setWebhooks(rest);
        setSelected(isMobile ? null : rest[0]?.id ?? null);
      },
    });
  }

  const replace = updated => setWebhooks(p => p.map(w => w.id === updated.id ? updated : w));
  const channelName = id => channels.find(c => c.id === id)?.name;
  const selectedHook = webhooks.find(w => w.id === selected);

  const list = (
    <>
      {loading && <MutedText style={{ padding: '0.4rem 0.6rem' }}>Loading…</MutedText>}
      {!loading && webhooks.length === 0 && <MutedText subtle style={{ padding: '0.4rem 0.6rem' }}>No webhooks yet</MutedText>}
      {webhooks.map(w => {
        const ch = channelName(w.channelId);
        return (
          <SplitItem key={w.id} active={selected === w.id} onClick={() => setSelected(w.id)} title={w.name}>
            <Avatar key={avatarVersions[w.id] ?? 0} src={avatarSrc(w, avatarVersions[w.id])} name={w.name} size={22} />
            <span className="ui-split-item-label" style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{w.name.trim() || <em style={{ color: 'var(--text-muted)' }}>unnamed</em>}</span>
              <span className="webhook-item-channel" data-missing={!ch}>
                {ch ? `# ${ch}` : <><WarningIcon size={10} /> No channel</>}
              </span>
            </span>
          </SplitItem>
        );
      })}
    </>
  );

  let detail;
  if (loading) {
    detail = null;
  } else if (loadErr) {
    detail = <TabBody><ErrorBox>{`Couldn't load webhooks: ${loadErr}`}</ErrorBox></TabBody>;
  } else if (selectedHook) {
    detail = (
      <WebhookEditor
        key={selectedHook.id}
        guildId={guildId}
        webhook={selectedHook}
        channels={channels}
        avatarVersion={avatarVersions[selectedHook.id] ?? 0}
        autoFocusName={justCreated === selectedHook.id}
        onChange={replace}
        onAvatarChanged={updated => {
          replace({ ...selectedHook, hasAvatar: updated.hasAvatar });
          setAvatarVersions(v => ({ ...v, [selectedHook.id]: Date.now() }));
        }}
        onDelete={handleDelete}
      />
    );
  } else {
    detail = (
      <EmptyState
        icon={WebhookIcon}
        title={webhooks.length ? 'Select a webhook' : 'No webhooks yet'}
        action={!webhooks.length && (
          <Button variant="primary" onClick={handleCreate} disabled={creating}><PlusIcon size={14} /> Create Webhook</Button>
        )}
        style={{ flex: 1 }}
      >
        A webhook is a URL that other apps can post messages to. It works with anything that supports Discord webhooks.
      </EmptyState>
    );
  }

  return (
    <>
      <SplitPane
        title="Webhooks"
        count={loading ? null : webhooks.length}
        action={
          <IconButton onClick={handleCreate} disabled={creating || loading} title="Create webhook" aria-label="Create webhook">
            <PlusIcon size={16} />
          </IconButton>
        }
        list={list}
        footer={createErr ? <ErrorBox>{createErr}</ErrorBox> : null}
        detail={detail}
        showDetail={!!selectedHook}
        onBack={() => setSelected(null)}
        backLabel="All webhooks"
      />
      {confirmDialog}
    </>
  );
}
