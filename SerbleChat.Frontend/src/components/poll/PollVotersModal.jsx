import { useState } from 'react';
import { Modal, ModalBody, EmptyState } from '../ui/index.js';
import Avatar from '../Avatar.jsx';
import UserInteraction from '../UserInteraction.jsx';
import { PollIcon } from '../../icons.jsx';
import { useResolvedUsers } from './useResolvedUsers.js';

/** Who voted for what: one tab per option, listing its voters. */
export default function PollVotersModal({ poll, onClose }) {
  const [selected, setSelected] = useState(() => {
    const first = poll.options.find(o => o.voterIds.length > 0) ?? poll.options[0];
    return first?.id;
  });
  const option = poll.options.find(o => o.id === selected) ?? poll.options[0];
  const users = useResolvedUsers(option?.voterIds ?? []);

  return (
    <Modal onClose={onClose} title="Votes" icon={PollIcon} width={560}>
      <ModalBody style={{ padding: 0 }}>
        <div className="poll-voters-question">{poll.question}</div>
        <div className="poll-voters">
          <div className="poll-voters-tabs" role="tablist">
            {poll.options.map(o => (
              <button
                key={o.id}
                type="button"
                role="tab"
                aria-selected={o.id === option?.id}
                className="poll-voters-tab"
                data-active={o.id === option?.id}
                onClick={() => setSelected(o.id)}
              >
                <span className="poll-voters-tab-text">{o.text}</span>
                <span className="poll-voters-tab-count">{o.voterIds.length}</span>
              </button>
            ))}
          </div>
          <div className="poll-voters-list">
            {option?.voterIds.length ? option.voterIds.map(id => (
              <UserInteraction key={id} userId={id} username={users[id]?.username}>
                <div className="poll-voter">
                  <Avatar userId={id} name={users[id]?.username} color={users[id]?.color} size={28} />
                  <span>{users[id]?.username ?? '…'}</span>
                </div>
              </UserInteraction>
            )) : (
              <EmptyState title="No votes yet" style={{ padding: '2rem 1rem' }} />
            )}
          </div>
        </div>
      </ModalBody>
    </Modal>
  );
}
