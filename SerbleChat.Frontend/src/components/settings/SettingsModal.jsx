import { useState } from 'react';
import { useMobile } from '../../context/MobileContext.jsx';
import { Modal } from '../ui/index.js';
import { PersonIcon, FolderIcon, PaletteIcon, ChatIcon, MicIcon, BellIcon, KeyboardIcon, GearIcon } from '../../icons.jsx';
import ProfileTab from './ProfileTab.jsx';
import FilesTab from './FilesTab.jsx';
import AppearanceTab from './AppearanceTab.jsx';
import ChatTab from './ChatTab.jsx';
import VoiceAudioTab from './VoiceAudioTab.jsx';
import NotificationsTab from './NotificationsTab.jsx';
import KeybindsTab from './KeybindsTab.jsx';

const TABS = [
  { id: 'profile',       icon: PersonIcon,   label: 'Profile',       section: 'My Account',   Component: ProfileTab },
  { id: 'files',         icon: FolderIcon,   label: 'Files',         section: 'My Account',   Component: FilesTab },
  { id: 'appearance',    icon: PaletteIcon,  label: 'Appearance',    section: 'App Settings', Component: AppearanceTab },
  { id: 'chat',          icon: ChatIcon,     label: 'Chat',          section: 'App Settings', Component: ChatTab },
  { id: 'voiceAudio',    icon: MicIcon,      label: 'Voice Audio',   section: 'App Settings', Component: VoiceAudioTab },
  { id: 'notifications', icon: BellIcon,     label: 'Notifications', section: 'App Settings', Component: NotificationsTab },
  { id: 'keybinds',      icon: KeyboardIcon, label: 'Keybinds',      section: 'App Settings', Component: KeybindsTab },
];

const SECTIONS = [...new Set(TABS.map(t => t.section))];

export default function SettingsModal({ onClose, initialTab = 'profile' }) {
  const [activeId, setActiveId] = useState(initialTab);
  const { isMobile } = useMobile();
  const active = TABS.find(t => t.id === activeId);

  return (
    // Fixed height so the modal doesn't jump around as tabs with different
    // amounts of content are selected; each tab scrolls internally.
    <Modal onClose={onClose} title="Settings" icon={GearIcon} width={880} height="min(720px, 100%)">
      <div style={{ display: 'flex', flex: 1, minHeight: 0, flexDirection: isMobile ? 'column' : 'row' }}>
        <nav
          className={isMobile ? 'no-scrollbar' : undefined}
          style={{
            flexShrink: 0,
            width: isMobile ? '100%' : 190,
            padding: isMobile ? '0.5rem' : '1rem 0.5rem',
            display: 'flex', flexDirection: isMobile ? 'row' : 'column',
            gap: isMobile ? '0.1rem' : '0.75rem',
            overflowX: isMobile ? 'auto' : 'hidden',
            overflowY: isMobile ? 'hidden' : 'auto',
            borderRight: isMobile ? 'none' : '1px solid var(--border)',
            borderBottom: isMobile ? '1px solid var(--border)' : 'none',
          }}
        >
          {SECTIONS.map(section => (
            <div key={section} style={{ display: 'flex', flexDirection: isMobile ? 'row' : 'column', gap: '0.1rem' }}>
              {!isMobile && <div className="ui-tab-section">{section}</div>}
              {TABS.filter(t => t.section === section).map(({ id, icon: Icon, label }) => (
                <button
                  key={id}
                  className="ui-tab"
                  data-active={id === activeId}
                  onClick={() => setActiveId(id)}
                >
                  <Icon size={16} />
                  {label}
                </button>
              ))}
            </div>
          ))}
        </nav>

        <div
          // VoiceContext checks for this to suspend voice hotkeys while they're being rebound
          data-keybinds-open={activeId === 'keybinds' ? 'true' : 'false'}
          style={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column' }}
        >
          <active.Component key={active.id} />
        </div>
      </div>
    </Modal>
  );
}
