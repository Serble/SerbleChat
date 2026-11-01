import { useState } from 'react';
import { useApp } from '../../context/AppContext.jsx';
import { Button } from '../ui/index.js';
import { PollIcon } from '../../icons.jsx';
import PollOptions from './PollOptions.jsx';
import PollVotersModal from './PollVotersModal.jsx';
import { usePollActions } from './usePollActions.js';
import { countVoters, formatTimeLeft, isPollEnded, pollExpiresAtMs, useNow } from './pollUtils.js';
import './poll.css';

/** The latest copy of a poll: the shared store, falling back to the one the message came with. */
export function useLivePoll(poll) {
  const { polls } = useApp();
  return (poll && polls[String(poll.id)]) || poll;
}

/** "3 votes · 12m left", "Poll ended", … */
export function PollStatus({ poll, ended, now, extra }) {
  const voters = countVoters(poll);
  const expires = pollExpiresAtMs(poll);
  const parts = [voters === 1 ? '1 vote' : `${voters} votes`];
  if (ended) parts.push('Poll ended');
  else if (expires != null) parts.push(formatTimeLeft(expires - now));
  if (extra) parts.push(extra);
  return <span className="poll-status">{parts.join(' · ')}</span>;
}

/** Can this user end the poll? Its author always can; in guilds, so can message managers. */
export function canEndPoll(poll, currentUserId, canManageMsgs) {
  return poll.authorId === currentUserId || (!!canManageMsgs && poll.authorId != null);
}

/** A poll shown in place of its message's text. */
export default function PollCard({ poll: initialPoll, canManageMsgs, isGuildChannel }) {
  const poll = useLivePoll(initialPoll);
  const { myId, myVotes, vote, close, closing } = usePollActions(poll);
  const running = !poll.closedAt && !isPollEnded(poll);
  const now = useNow(running && poll.expiresAt != null);
  const ended = isPollEnded(poll, now);
  const [showVoters, setShowVoters] = useState(false);
  // Message managers only have powers in guilds; elsewhere only the author can end it
  const canEnd = !ended && canEndPoll(poll, myId, isGuildChannel && canManageMsgs);

  return (
    <div className="poll-card" data-ended={ended}>
      <div className="poll-kicker">
        <PollIcon size={13} />
        <span>Poll</span>
        <span className="poll-kicker-sep">·</span>
        <span>{poll.allowMultiple ? 'Select one or more' : 'Select one'}</span>
      </div>
      <div className="poll-question">{poll.question}</div>
      <PollOptions poll={poll} myVotes={myVotes} ended={ended} onVote={vote} />
      <div className="poll-footer">
        <PollStatus poll={poll} ended={ended} now={now} />
        <span style={{ flex: 1 }} />
        <Button variant="ghost" size="sm" onClick={() => setShowVoters(true)} disabled={countVoters(poll) === 0}>
          View votes
        </Button>
        {canEnd && (
          <Button variant="outline" size="sm" onClick={close} disabled={closing}>
            {closing ? 'Ending…' : 'End now'}
          </Button>
        )}
      </div>
      {showVoters && <PollVotersModal poll={poll} onClose={() => setShowVoters(false)} />}
    </div>
  );
}
