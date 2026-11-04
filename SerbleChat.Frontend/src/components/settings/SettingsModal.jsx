import { useState } from 'react';
import { TabbedModal } from '../ui/index.js';
import { PersonIcon, FolderIcon, PaletteIcon, ChatIcon, MicIcon, BellIcon, KeyboardIcon, GearIcon, PuzzleIcon } from '../../icons.jsx';
import ProfileTab from './ProfileTab.jsx';
import FilesTab from './FilesTab.jsx';
import AppearanceTab from './AppearanceTab.jsx';
import ChatTab from './ChatTab.jsx';
import VoiceAudioTab from './VoiceAudioTab.jsx';
import NotificationsTab from './NotificationsTab.jsx';
import KeybindsTab from './KeybindsTab.jsx';
import ModsTab from './ModsTab.jsx';

const TABS = [
  { id: 'profile',       icon: PersonIcon,   label: 'Profile',       section: 'My Account',   Component: ProfileTab },
  { id: 'files',         icon: FolderIcon,   label: 'Files',         section: 'My Account',   Component: FilesTab },
  { id: 'appearance',    icon: PaletteIcon,  label: 'Appearance',    section: 'App Settings', Component: AppearanceTab },
  { id: 'chat',          icon: ChatIcon,     label: 'Chat',          section: 'App Settings', Component: ChatTab },
  { id: 'voiceAudio',    icon: MicIcon,      label: 'Voice & Video', section: 'App Settings', Component: VoiceAudioTab },
  { id: 'notifications', icon: BellIcon,     label: 'Notifications', section: 'App Settings', Component: NotificationsTab },
  { id: 'keybinds',      icon: KeyboardIcon, label: 'Keybinds',      section: 'App Settings', Component: KeybindsTab },
  // Mods only exist in the desktop app
  ...(window.electron?.mods ? [{ id: 'mods', icon: PuzzleIcon, label: 'Mods', section: 'App Settings', Component: ModsTab }] : []),
];

export default function SettingsModal({ onClose, initialTab = 'profile' }) {
  const [activeId, setActiveId] = useState(initialTab);
  const active = TABS.find(t => t.id === activeId);

  return (
    <TabbedModal
      onClose={onClose}
      title="Settings"
      icon={GearIcon}
      tabs={TABS}
      active={activeId}
      onChange={setActiveId}
      // VoiceContext checks for this to suspend voice hotkeys while they're being rebound
      bodyProps={{ 'data-keybinds-open': activeId === 'keybinds' ? 'true' : 'false' }}
    >
      <active.Component key={active.id} />
    </TabbedModal>
  );
}
