import { FRONTEND_URL } from '../../api.js';
import { copyToClipboard, triggerDownload } from '../../electron-utils.js';
import { ClipboardIcon, LinkIcon, IdCardIcon, EditIcon, TrashIcon, GlobeIcon, SaveIcon } from '../../icons.jsx';
import { ContextMenu, MenuItem, MenuDivider, useCopyFlash } from '../ui/index.js';

function messageLink(msg) {
  return `${FRONTEND_URL}/app/channel/${msg.channelId}?message=${msg.id}`;
}

/** Copy `text`, then show "Copied!" on the item and close the menu. */
function copyThenFlash(text, flash, key, what) {
  copyToClipboard(text).catch(err => console.error(`Failed to copy ${what}:`, err));
  flash(key);
}

/** Right-click menu for a message. Edit/Delete only appear when allowed. */
export function MessageContextMenu({ x, y, msg, canEdit, canDelete, onEdit, onDelete, onClose }) {
  const [copied, flash] = useCopyFlash(onClose);

  return (
    <ContextMenu x={x} y={y} onClose={onClose} zIndex={500}>
      <MenuItem icon={ClipboardIcon} label="Copy Text" copied={copied === 'text'}
        onClick={() => copyThenFlash(msg.content, flash, 'text', 'text')} />
      <MenuItem icon={LinkIcon} label="Copy Message Link" copied={copied === 'link'}
        onClick={() => copyThenFlash(messageLink(msg), flash, 'link', 'message link')} />
      <MenuItem icon={IdCardIcon} label="Copy Message ID" copied={copied === 'id'}
        onClick={() => copyThenFlash(String(msg.id), flash, 'id', 'message ID')} />
      {(canEdit || canDelete) && (
        <>
          <MenuDivider />
          {canEdit && <MenuItem icon={EditIcon} label="Edit Message" onClick={onEdit} />}
          {canDelete && <MenuItem icon={TrashIcon} label="Delete Message" variant="danger" onClick={onDelete} />}
        </>
      )}
    </ContextMenu>
  );
}

/**
 * Right-click menu for an embedded image. When opened from a message (not the
 * fullscreen viewer) `msg` is set and the message's own copy actions are shown too.
 */
export function ImageContextMenu({ x, y, imageUrl, filename, msg, onClose }) {
  const [copied, flash] = useCopyFlash(onClose);

  function copyImage() {
    fetch(imageUrl)
      .then(res => res.blob())
      .then(blob => {
        if (!navigator.clipboard?.write) throw new Error('Clipboard API not available');
        return navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
      })
      .then(() => flash('image'))
      .catch(err => {
        console.error('Failed to copy image:', err);
        onClose();
      });
  }

  return (
    // Above the fullscreen image viewer
    <ContextMenu x={x} y={y} onClose={onClose} zIndex={99999}>
      {msg && (
        <>
          <MenuItem icon={ClipboardIcon} label="Copy Text" copied={copied === 'text'}
            onClick={() => copyThenFlash(msg.content, flash, 'text', 'text')} />
          <MenuItem icon={LinkIcon} label="Copy Message Link" copied={copied === 'link'}
            onClick={() => copyThenFlash(messageLink(msg), flash, 'link', 'message link')} />
          <MenuDivider />
        </>
      )}
      <MenuItem icon={LinkIcon} label="Copy Image Link" copied={copied === 'image-link'}
        onClick={() => copyThenFlash(imageUrl, flash, 'image-link', 'image link')} />
      <MenuItem icon={GlobeIcon} label="Open Image"
        onClick={() => { window.open(imageUrl, '_blank'); onClose(); }} />
      <MenuItem icon={ClipboardIcon} label="Copy Image" copied={copied === 'image'} onClick={copyImage} />
      <MenuItem icon={SaveIcon} label="Save Image"
        onClick={() => { triggerDownload(imageUrl, filename || 'image'); onClose(); }} />
    </ContextMenu>
  );
}
