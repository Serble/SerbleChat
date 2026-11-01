import { useMemo, useRef, useState } from 'react';
import { useApp } from '../../context/AppContext.jsx';
import { votePoll, closePoll } from '../../api.js';
import { withVotes } from './pollUtils.js';

/**
 * Voting and ending for one poll. Votes show immediately and are sent one at a
 * time, so quick clicks on a multiple-choice poll reach the server in order.
 */
export function usePollActions(poll) {
  const { currentUser, upsertPolls, addToast } = useApp();
  const myId = currentUser?.id;
  const queueRef = useRef(Promise.resolve());
  const [closing, setClosing] = useState(false);

  const myVotes = useMemo(() => {
    const set = new Set();
    for (const o of poll?.options ?? []) if (o.voterIds.includes(myId)) set.add(o.id);
    return set;
  }, [poll, myId]);

  function vote(optionId) {
    if (!poll || !myId) return;
    let next;
    if (poll.allowMultiple) {
      next = myVotes.has(optionId) ? [...myVotes].filter(id => id !== optionId) : [...myVotes, optionId];
    } else {
      // Clicking your current choice again takes your vote back
      next = myVotes.has(optionId) ? [] : [optionId];
    }
    const previous = poll;
    upsertPolls([withVotes(poll, myId, next)]);
    queueRef.current = queueRef.current.then(async () => {
      try {
        const updated = await votePoll(poll.channelId, poll.id, next);
        if (updated) upsertPolls([updated]);
      } catch (e) {
        console.error('Vote failed:', e);
        upsertPolls([previous]);
        addToast({ title: "Couldn't vote", body: e?.message || 'Please try again.', type: 'error' });
      }
    });
  }

  async function close() {
    if (!poll || closing) return;
    setClosing(true);
    try {
      const updated = await closePoll(poll.channelId, poll.id);
      if (updated) upsertPolls([updated]);
    } catch (e) {
      console.error('Ending poll failed:', e);
      addToast({ title: "Couldn't end poll", body: e?.message || 'Please try again.', type: 'error' });
    } finally {
      setClosing(false);
    }
  }

  return { myId, myVotes, vote, close, closing };
}
