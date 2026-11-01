import { useRef, useState } from 'react';
import { Modal, ModalBody, ModalFooter, Button, TextInput, Select, Field, SettingRow, Toggle, ErrorBox, IconButton } from '../ui/index.js';
import { PollIcon, PlusIcon, CloseIcon } from '../../icons.jsx';
import { createPoll } from '../../api.js';
import { DURATION_OPTIONS, MAX_OPTIONS, MIN_OPTIONS, OPTION_MAX, QUESTION_MAX } from './pollUtils.js';
import './poll.css';

/** Dialog for writing and posting a poll to `channelId`. */
export default function PollCreateModal({ channelId, onClose, onCreated }) {
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState(['', '']);
  const [allowMultiple, setAllowMultiple] = useState(false);
  const [duration, setDuration] = useState('none');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const optionRefs = useRef([]);

  const filled = options.map(o => o.trim()).filter(Boolean);
  const canPost = question.trim() && filled.length >= MIN_OPTIONS && !busy;

  function setOption(i, value) {
    setOptions(p => p.map((o, j) => (j === i ? value : o)));
  }

  function addOption(focus = true) {
    if (options.length >= MAX_OPTIONS) return;
    setOptions(p => [...p, '']);
    if (focus) requestAnimationFrame(() => optionRefs.current[options.length]?.focus());
  }

  function removeOption(i) {
    setOptions(p => p.filter((_, j) => j !== i));
  }

  async function submit() {
    if (!canPost) return;
    setBusy(true);
    setError(null);
    try {
      await createPoll(channelId, {
        question: question.trim(),
        options: filled,
        allowMultiple,
        durationSeconds: duration === 'none' ? null : Number(duration),
      });
      onCreated?.();
      onClose();
    } catch (e) {
      setError(e?.status === 403 ? "You don't have permission to create polls here." : (e?.message || 'Failed to create poll.'));
      setBusy(false);
    }
  }

  return (
    <Modal onClose={onClose} title="Create a poll" icon={PollIcon} width={520} onSubmit={submit}>
      <ModalBody style={{ display: 'flex', flexDirection: 'column', gap: '1.1rem' }}>
        <Field label="Question" htmlFor="poll-question">
          <TextInput
            id="poll-question"
            autoFocus
            value={question}
            maxLength={QUESTION_MAX}
            placeholder="What should we play next?"
            onChange={e => setQuestion(e.target.value)}
          />
        </Field>

        <Field label="Answers">
          <div className="poll-create-options">
            {options.map((value, i) => (
              <div key={i} className="poll-create-option">
                <TextInput
                  ref={el => { optionRefs.current[i] = el; }}
                  value={value}
                  maxLength={OPTION_MAX}
                  placeholder={`Answer ${i + 1}`}
                  onChange={e => setOption(i, e.target.value)}
                  onKeyDown={e => {
                    // Enter in the last answer adds another instead of posting
                    if (e.key === 'Enter' && i === options.length - 1 && value.trim() && options.length < MAX_OPTIONS) {
                      e.preventDefault();
                      addOption();
                    }
                  }}
                />
                <IconButton
                  onClick={() => removeOption(i)}
                  disabled={options.length <= MIN_OPTIONS}
                  title="Remove answer"
                  aria-label={`Remove answer ${i + 1}`}
                >
                  <CloseIcon size={14} />
                </IconButton>
              </div>
            ))}
            {options.length < MAX_OPTIONS && (
              <Button variant="ghost" size="sm" onClick={() => addOption()} style={{ alignSelf: 'flex-start' }}>
                <PlusIcon size={14} /> Add answer
              </Button>
            )}
          </div>
        </Field>

        <Field label="Duration" htmlFor="poll-duration" hint="Results are live, and you can end the poll early at any time.">
          <Select id="poll-duration" value={duration} onChange={e => setDuration(e.target.value)}>
            {DURATION_OPTIONS.map(o => (
              <option key={o.label} value={o.value ?? 'none'}>{o.label}</option>
            ))}
          </Select>
        </Field>

        <SettingRow
          title="Allow multiple answers"
          description="Voters can pick more than one answer."
          control={<Toggle checked={allowMultiple} onChange={setAllowMultiple} />}
          style={{ marginBottom: 0 }}
        />

        <ErrorBox>{error}</ErrorBox>
      </ModalBody>
      <ModalFooter>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button variant="primary" type="submit" disabled={!canPost}>{busy ? 'Posting…' : 'Post poll'}</Button>
      </ModalFooter>
    </Modal>
  );
}
