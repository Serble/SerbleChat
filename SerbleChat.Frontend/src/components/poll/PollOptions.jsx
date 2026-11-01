import Avatar from '../Avatar.jsx';
import { CheckIcon } from '../../icons.jsx';
import { countVoters } from './pollUtils.js';
import { useResolvedUsers } from './useResolvedUsers.js';

const MAX_FACES = 3;

/** The first few voters' avatars, with every name in the tooltip. */
function VoterFaces({ voterIds, users, size }) {
  if (voterIds.length === 0) return null;
  const names = voterIds.map(id => users[id]?.username ?? '…');
  return (
    <span className="poll-faces" title={names.join(', ')}>
      {voterIds.slice(0, MAX_FACES).map(id => (
        <Avatar key={id} userId={id} name={users[id]?.username} color={users[id]?.color} size={size} />
      ))}
    </span>
  );
}

/**
 * The answer list of a poll: each option is a button showing its live share of
 * voters as a bar, who voted for it, and whether you picked it.
 * `compact` is the denser layout used in the voice panel.
 */
export default function PollOptions({ poll, myVotes, ended, onVote, compact = false }) {
  const allVoters = poll.options.flatMap(o => o.voterIds);
  const users = useResolvedUsers([...new Set(allVoters)]);
  const total = countVoters(poll);
  const top = Math.max(0, ...poll.options.map(o => o.voterIds.length));

  return (
    <div className="poll-options" data-compact={compact}>
      {poll.options.map(option => {
        const count = option.voterIds.length;
        const pct = total ? Math.round((count / total) * 100) : 0;
        const mine = myVotes.has(option.id);
        const winner = ended && count > 0 && count === top;
        return (
          <button
            key={option.id}
            type="button"
            className="poll-option"
            data-mine={mine}
            data-winner={winner}
            data-multi={poll.allowMultiple}
            disabled={ended}
            onClick={() => onVote(option.id)}
            style={{ '--poll-pct': `${pct}%` }}
            title={ended ? undefined : mine ? 'Click to remove your vote' : 'Vote for this'}
            aria-pressed={mine}
          >
            <span className="poll-option-mark" aria-hidden="true">{mine && <CheckIcon size={compact ? 10 : 12} strokeWidth={3} />}</span>
            <span className="poll-option-text">{option.text}</span>
            <VoterFaces voterIds={option.voterIds} users={users} size={compact ? 16 : 18} />
            <span className="poll-option-count">{count}</span>
            <span className="poll-option-pct">{pct}%</span>
          </button>
        );
      })}
    </div>
  );
}
