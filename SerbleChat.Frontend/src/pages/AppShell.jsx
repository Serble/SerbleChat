import { Routes, Route, Navigate } from 'react-router-dom';
import ServerStrip  from '../components/ServerStrip.jsx';
import DmSidebar    from '../components/DmSidebar.jsx';
import FriendsHome  from '../components/FriendsHome.jsx';
import ChatView     from '../components/ChatView.jsx';

export default function AppShell() {
  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      <ServerStrip />
      <DmSidebar />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: '#313338' }}>
        <Routes>
          <Route index                      element={<Navigate to="friends" replace />} />
          <Route path="friends"             element={<FriendsHome />} />
          <Route path="channel/:channelId"  element={<ChatView />} />
        </Routes>
      </div>
    </div>
  );
}
