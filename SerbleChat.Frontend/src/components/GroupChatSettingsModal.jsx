import { uploadGroupChatIcon, deleteGroupChatIcon } from '../api.js';
import { PeopleIcon } from '../icons.jsx';
import { Modal, ModalBody, ModalFooter, Button, Field, IconUploadField } from './ui/index.js';
import useGroupChatIcon from './useGroupChatIcon.js';

export default function GroupChatSettingsModal({ chat, onClose, channelUpdatedEvent }) {
  const icon = useGroupChatIcon(chat.channelId, channelUpdatedEvent);

  return (
    <Modal onClose={onClose} title="Group Chat Settings" subtitle={chat.name} width={440}>
      <ModalBody>
        {/* The ChannelUpdated signal refreshes the preview after an upload / removal */}
        <Field label="Group Icon">
          <IconUploadField
            src={icon.hasIcon ? icon.src : null}
            fallback={<PeopleIcon size={34} />}
            alt="Group chat icon"
            hint="Everyone in the group sees this icon. Square images work best."
            onImageError={icon.onError}
            onUpload={file => uploadGroupChatIcon(chat.channelId, file)}
            onRemove={() => deleteGroupChatIcon(chat.channelId)}
          />
        </Field>
      </ModalBody>
      <ModalFooter>
        <Button variant="primary" onClick={onClose}>Done</Button>
      </ModalFooter>
    </Modal>
  );
}
