import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Button, IconButton } from '../ui/index.js';
import { ChevronLeftIcon, ChevronRightIcon, PollIcon } from '../../icons.jsx';
import PollOptions from './PollOptions.jsx';
import { PollStatus, canEndPoll } from './PollCard.jsx';
import { usePollActions } from './usePollActions.js';
import { useActivePolls } from './useActivePolls.js';
import { isPollEnded, useNow } from './pollUtils.js';
import './poll.css';

function StripPoll({ poll, index, count, onPrev, onNext, canManageMsgs }) {
  const { myId, myVotes, vote, close, closing } = usePollActions(poll);
  const now = useNow(poll.expiresAt != null);
  const ended = isPollEnded(poll, now);
  const [, setSearchParams] = useSearchParams();

  return (
    <div className="poll-strip">
      <div className="poll-strip-head">
        <PollIcon size={14} />
        <span className="poll-strip-question" title={poll.question}>{poll.question}</span>
        {count > 1 && (
          <div className="poll-strip-pager">
            <IconButton onClick={onPrev} title="Newer poll" aria-label="Newer poll" disabled={index === 0}>
              <ChevronLeftIcon size={14} />
            </IconButton>
            <span className="poll-strip-page">{index + 1} / {count}</span>
            <IconButton onClick={onNext} title="Older poll" aria-label="Older poll" disabled={index === count - 1}>
              <ChevronRightIcon size={14} />
            </IconButton>
          </div>
        )}
      </div>
      <PollOptions poll={poll} myVotes={myVotes} ended={ended} onVote={vote} compact />
      <div className="poll-footer">
        <PollStatus poll={poll} ended={ended} now={now} extra={poll.allowMultiple ? 'Pick any' : null} />
        <span style={{ flex: 1 }} />
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setSearchParams(p => { p.set('message', String(poll.messageId)); return p; }, { replace: true })}
        >
          Jump to poll
        </Button>
        {!ended && canEndPoll(poll, myId, canManageMsgs) && (
          <Button variant="outline" size="sm" onClick={close} disabled={closing}>
            {closing ? 'Ending…' : 'End now'}
          </Button>
        )}
      </div>
    </div>
  );
}

/**
 * Running polls for a voice channel, pinned in the "In Voice" panel so people in
 * the call can vote without scrolling. Shows the newest; arrows page through the rest.
 * `canManageMsgs` should only be true in guild channels.
 */
export default function VoicePollStrip({ channelId, canManageMsgs = false }) {
  const active = useActivePolls(channelId);
  const [selectedId, setSelectedId] = useState(null);

  // Jump to the newest poll whenever a new one is posted
  const newestId = active[0]?.id ?? null;
  useEffect(() => { setSelectedId(newestId); }, [newestId]);

  if (active.length === 0) return null;
  let index = active.findIndex(p => p.id === selectedId);
  if (index === -1) index = 0;  // the selected one ended or was deleted
  const poll = active[index];

  return (
    <StripPoll
      key={poll.id}
      poll={poll}
      index={index}
      count={active.length}
      onPrev={() => setSelectedId(active[Math.max(0, index - 1)].id)}
      onNext={() => setSelectedId(active[Math.min(active.length - 1, index + 1)].id)}
      canManageMsgs={canManageMsgs}
    />
  );
}
