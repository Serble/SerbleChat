import { useState, useEffect, useRef, useMemo } from 'react';
import { useApp } from '../../context/AppContext.jsx';
import { useClientOptions } from '../../context/ClientOptionsContext.jsx';
import { Button, ErrorBox } from '../ui/index.js';
import { AttachmentIcon, BlockIcon, CloseIcon, LockIcon, PlusIcon, PollIcon, SendIcon } from '../../icons.jsx';
import { MenuItem } from '../ui/index.js';
import './chat.css';
import { MentionPicker } from './MentionRenderer.jsx';
import { FileUploadPanel } from './FileUploadPanel.jsx';

const INPUT_MAX_HEIGHT = 320; // ≈ 20rem
// Send at most one typing notification per this interval
const TYPING_THROTTLE_MS = 2000;

/** Rank and cap mention suggestions for the current "@query". */
function buildSuggestions(query, mentionData) {
  const q = query.toLowerCase();
  const score = (label) => label.toLowerCase().startsWith(q) ? 0 : 1;
  const pick = (list, labelOf, limit) => list
    .filter(item => !q || labelOf(item).toLowerCase().includes(q))
    .sort((a, b) => score(labelOf(a)) - score(labelOf(b)))
    .slice(0, limit);

  return [
    ...pick(mentionData.members, m => m.username, 5).map(m => ({ type: 'user', id: m.id, label: m.username, color: m.color })),
    ...pick(mentionData.channels, c => c.name, 3).map(c => ({ type: 'channel', id: c.id, label: c.name, color: null })),
    ...pick(mentionData.roles, r => r.name, 3).map(r => ({ type: 'role', id: r.id, label: r.name, color: r.color })),
  ];
}

/**
 * The "+" button's menu of extras (upload, poll), opening upwards from the
 * composer. Closes on Escape, a click outside, or picking an item.
 */
function ComposerMenu({ onClose, buttonRef, children }) {
  const ref = useRef(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; });

  useEffect(() => {
    function onDown(e) {
      // The "+" button toggles the menu itself
      if (ref.current?.contains(e.target) || buttonRef.current?.contains(e.target)) return;
      onCloseRef.current();
    }
    function onKey(e) {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      onCloseRef.current();
      buttonRef.current?.focus();
    }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    ref.current?.querySelector('[role="menuitem"]')?.focus();
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [buttonRef]);

  return <div ref={ref} role="menu" className="ui-menu composer-menu">{children}</div>;
}

/**
 * Message input bar: attachments, send error, @mention autocomplete and the
 * auto-growing textarea. The draft text lives in ChatView (it's reset on
 * channel switch and read by the send logic); everything else is local.
 */
export default function Composer({
  channelId, input, setInput, inputRef, placeholder, mentionData,
  fileUploads, sendError, onDismissError, onSend, onEditLast, onCreatePoll,
}) {
  const { hubRef } = useApp();
  const { sendTypingIndicators } = useClientOptions() ?? { sendTypingIndicators: true };
  const [mentionPicker, setMentionPicker] = useState(null); // { query, atIndex } | null
  const [pickerIndex, setPickerIndex] = useState(0);
  const lastTypingNotifyRef = useRef(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const plusRef = useRef(null);

  // Fresh picker and typing throttle for each channel
  useEffect(() => {
    setMentionPicker(null);
    setMenuOpen(false);
    lastTypingNotifyRef.current = 0;
  }, [channelId]);

  // Auto-resize textarea as content grows/shrinks
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, INPUT_MAX_HEIGHT) + 'px';
  }, [input, inputRef]);

  // ── Mention autocomplete ──────────────────────────────────────────────────

  function detectMention(text, cursorPos) {
    const before = text.slice(0, cursorPos);
    const atIdx  = before.lastIndexOf('@');
    if (atIdx === -1) { setMentionPicker(null); return; }
    const query = before.slice(atIdx + 1);
    // Cancel if there's a space/newline between @ and cursor
    if (/\s/.test(query)) { setMentionPicker(null); return; }
    setMentionPicker({ query, atIndex: atIdx });
    setPickerIndex(0);
  }

  const pickerSuggestions = useMemo(
    () => mentionPicker ? buildSuggestions(mentionPicker.query, mentionData) : [],
    [mentionPicker, mentionData]
  );

  function insertMention(suggestion) {
    if (!mentionPicker) return;
    const { atIndex, query } = mentionPicker;
    const before = input.slice(0, atIndex);
    const after  = input.slice(atIndex + 1 + query.length);
    const token  = `<@${suggestion.type}:${suggestion.id}> `;
    setInput(before + token + after);
    setMentionPicker(null);
    // Restore focus and place cursor after the inserted token
    requestAnimationFrame(() => {
      const el = inputRef.current;
      if (!el) return;
      el.focus();
      const pos = before.length + token.length;
      el.setSelectionRange(pos, pos);
    });
  }

  // ── Typing indicator ──────────────────────────────────────────────────────

  function notifyTyping() {
    if (!sendTypingIndicators || !hubRef?.current) return;
    const now = Date.now();
    if (now - lastTypingNotifyRef.current < TYPING_THROTTLE_MS) return;
    lastTypingNotifyRef.current = now;
    try {
      hubRef.current.invoke('NotifyTyping', Number(channelId)).catch(e => {
        console.warn('Failed to notify typing:', e);
      });
    } catch (e) {
      console.warn('Failed to notify typing:', e);
    }
  }

  // ── Keyboard / paste ──────────────────────────────────────────────────────

  function handleKeyDown(e) {
    // Mention picker keyboard navigation takes priority
    if (mentionPicker && pickerSuggestions.length > 0) {
      if (e.key === 'ArrowUp')   { e.preventDefault(); setPickerIndex(i => Math.max(0, i - 1)); return; }
      if (e.key === 'ArrowDown') { e.preventDefault(); setPickerIndex(i => Math.min(pickerSuggestions.length - 1, i + 1)); return; }
      if (e.key === 'Tab' || e.key === 'Enter') {
        e.preventDefault(); insertMention(pickerSuggestions[pickerIndex]); return;
      }
      if (e.key === 'Escape') { e.preventDefault(); setMentionPicker(null); return; }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onSend();
    }
    // Up arrow on empty input — edit last own message (Discord-style)
    if (e.key === 'ArrowUp' && !input.trim() && !mentionPicker) {
      if (onEditLast()) e.preventDefault();
    }
  }

  function handlePaste(e) {
    const items = e.clipboardData?.items;
    if (!items) return;
    const files = [];
    for (let i = 0; i < items.length; i++) {
      if (items[i].kind !== 'file') continue;
      const file = items[i].getAsFile();
      if (file) files.push(file);
    }
    // Pasted files go to the upload queue instead of being pasted as text
    if (files.length > 0) {
      e.preventDefault();
      fileUploads.addFiles(files);
    }
  }

  function handleFileInputChange(e) {
    if (e.target.files && e.target.files.length > 0) {
      fileUploads.addFiles(e.target.files);
      // Reset input so the same file can be selected again
      e.target.value = '';
    }
  }

  const { uploading } = fileUploads;
  const canSubmit = input.trim() || fileUploads.files.length > 0;

  return (
    <>
      <FileUploadPanel uploads={fileUploads} />

      {sendError && (
        <ErrorBox style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
          <BlockIcon size={16} style={{ flexShrink: 0 }} />
          <span style={{ flex: 1 }}>{sendError}</span>
          <button
            type="button"
            onClick={onDismissError}
            title="Dismiss"
            style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', lineHeight: 1, padding: '0 0.1rem', opacity: 0.7, flexShrink: 0 }}
          ><CloseIcon size={14} /></button>
        </ErrorBox>
      )}

      <form onSubmit={e => { e.preventDefault(); onSend(); }} style={{ position: 'relative' }}>
        {mentionPicker && (
          <MentionPicker
            suggestions={pickerSuggestions}
            selectedIndex={pickerIndex}
            onSelect={insertMention}
            onHoverIndex={setPickerIndex}
          />
        )}

        {menuOpen && (
          <ComposerMenu onClose={() => setMenuOpen(false)} buttonRef={plusRef}>
            <MenuItem
              icon={AttachmentIcon}
              label="Upload a file"
              disabled={uploading}
              onClick={() => { setMenuOpen(false); fileUploads.fileInputRef.current?.click(); }}
            />
            {onCreatePoll && (
              <MenuItem
                icon={PollIcon}
                label="Create a poll"
                onClick={() => { setMenuOpen(false); onCreatePoll(); }}
              />
            )}
          </ComposerMenu>
        )}

        <div className="composer">
          <button
            ref={plusRef}
            type="button"
            className="composer-btn composer-plus"
            data-open={menuOpen}
            onClick={() => setMenuOpen(v => !v)}
            title="More options"
            aria-label="More options"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
          >
            <PlusIcon size={20} />
          </button>

          <input
            ref={fileUploads.fileInputRef}
            type="file"
            multiple
            onChange={handleFileInputChange}
            style={{ display: 'none' }}
          />

          <textarea
            ref={inputRef}
            rows={1}
            className="composer-input"
            placeholder={placeholder}
            value={input}
            onChange={e => {
              setInput(e.target.value);
              onDismissError();
              detectMention(e.target.value, e.target.selectionStart);
              notifyTyping();
            }}
            onKeyDown={handleKeyDown}
            onKeyUp={e => {
              if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) {
                detectMention(input, e.target.selectionStart);
              }
            }}
            onClick={e => detectMention(input, e.target.selectionStart)}
            onPaste={handlePaste}
            maxLength={16384}
          />

          <button
            type="submit"
            className="composer-btn composer-send"
            data-ready={!!canSubmit && !uploading}
            disabled={!canSubmit || uploading}
            title={uploading ? 'Uploading…' : 'Send'}
          >
            {uploading ? <span className="msg-spinner" /> : <SendIcon size={18} />}
          </button>
        </div>
      </form>
    </>
  );
}

/** Replaces the composer in a DM with a user you've blocked. */
export function BlockedInputBanner({ username, userId, unblockUser }) {
  const [busy, setBusy] = useState(false);

  async function handleUnblock() {
    setBusy(true);
    try { await unblockUser(userId); }
    catch (e) { console.error(e); }
    finally { setBusy(false); }
  }

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: '0.75rem',
      padding: '0.75rem 1rem',
      background: 'var(--danger-soft)', border: '1px solid var(--danger-border)',
      borderRadius: '8px', color: 'var(--text-muted)', fontSize: '0.875rem',
    }}>
      <BlockIcon size={16} style={{ flexShrink: 0 }} />
      <span style={{ flex: 1 }}>
        You have blocked <strong style={{ color: 'var(--text-secondary)' }}>{username}</strong>. You cannot send messages until you unblock them.
      </span>
      <Button variant="danger" size="sm" onClick={handleUnblock} disabled={busy} style={{ flexShrink: 0 }}>
        {busy ? 'Unblocking…' : 'Unblock'}
      </Button>
    </div>
  );
}

/** Replaces the composer when the user lacks Send Messages permission. */
export function NoPermissionNotice() {
  return (
    <div style={{ background: 'var(--bg-secondary)', borderRadius: '8px', padding: '0.75rem 1rem', color: 'var(--text-muted)', fontSize: '0.875rem', textAlign: 'center' }}>
      <LockIcon size={14} /> You don't have permission to send messages here.
    </div>
  );
}
