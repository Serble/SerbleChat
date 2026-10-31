import { useState, useEffect } from 'react';
import { useClientOptions } from '../../context/ClientOptionsContext.jsx';
import { Slider, TextInput, SettingRow, ToggleRow, SectionTitle, OptionGroup } from '../ui/index.js';
import { BlockIcon, EyeIcon, TrashIcon } from '../../icons.jsx';
import { TabBody } from './common.jsx';

const LINES_MIN = 5;
const LINES_MAX = 200;

const BLOCKED_MODES = [
  {
    value: 'masked',
    label: 'Masked',
    icon: BlockIcon,
    badge: 'Default',
    description: 'Show a collapsed "message from blocked user" placeholder that can be expanded on click.',
  },
  {
    value: 'visible',
    label: 'Fully visible',
    icon: EyeIcon,
    description: 'Show messages from blocked users exactly like any other message.',
  },
  {
    value: 'hidden',
    label: 'Hidden',
    icon: TrashIcon,
    description: 'Completely remove messages from blocked users — they will not appear at all.',
  },
];

export default function ChatTab() {
  const {
    messageLinesLimit, setMessageLinesLimit,
    blockedMessageMode, setBlockedMessageMode,
    sendTypingIndicators, setSendTypingIndicators,
  } = useClientOptions();

  // The number box is edited as free text and committed on blur/Enter.
  const [draft, setDraft] = useState(String(messageLinesLimit));
  useEffect(() => { setDraft(String(messageLinesLimit)); }, [messageLinesLimit]);

  function commitDraft() {
    const n = Math.max(LINES_MIN, Math.min(LINES_MAX, parseInt(draft, 10) || messageLinesLimit));
    setDraft(String(n));
    setMessageLinesLimit(n);
  }

  return (
    <TabBody>
      <SectionTitle>Message Display</SectionTitle>

      <SettingRow
        title="Lines before collapse"
        control={
          <TextInput
            type="number"
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onBlur={commitDraft}
            onKeyDown={e => { if (e.key === 'Enter') e.target.blur(); }}
            min={LINES_MIN}
            max={LINES_MAX}
            style={{ width: 76, textAlign: 'center', padding: '0.35rem 0.5rem' }}
          />
        }
      >
        <Slider
          min={LINES_MIN}
          max={LINES_MAX}
          value={messageLinesLimit}
          onChange={setMessageLinesLimit}
          style={{ margin: '0.85rem 0 0.6rem' }}
        />
        <div className="ui-hint">
          Messages with more than <strong style={{ color: 'var(--text-secondary)' }}>{messageLinesLimit} lines</strong> will
          be visually collapsed with a "Show more" button. The full content is always
          retained — only the display is clipped.
        </div>
      </SettingRow>

      <ToggleRow
        title="Send typing indicators"
        description="When enabled, other users will see when you're composing a message. You will always see when others are typing regardless of this setting."
        checked={sendTypingIndicators}
        onChange={setSendTypingIndicators}
      />

      <SectionTitle>Blocked Users</SectionTitle>
      <div style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.75rem' }}>
        Messages from blocked users
      </div>
      <OptionGroup options={BLOCKED_MODES} value={blockedMessageMode} onChange={setBlockedMessageMode} />
    </TabBody>
  );
}
