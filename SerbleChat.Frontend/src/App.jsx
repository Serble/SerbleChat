import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useEffect } from 'react';
import LandingPage  from './pages/LandingPage.jsx';
import CallbackPage from './pages/CallbackPage.jsx';
import FilesCallbackPage from './pages/FilesCallbackPage.jsx';
import AppShell     from './pages/AppShell.jsx';
import InvitePage   from './pages/InvitePage.jsx';
import { AppProvider } from './context/AppContext.jsx';
import { ThemeProvider } from './context/ThemeContext.jsx';
import { ClientOptionsProvider } from './context/ClientOptionsContext.jsx';
import { MobileProvider } from './context/MobileContext.jsx';
import { VoiceProvider } from './context/VoiceContext.jsx';
import { initializeMediaPermissions } from './electron-utils.js';

function ProtectedRoute({ children }) {
  return localStorage.getItem('jwt') ? children : <Navigate to="/" replace />;
}

export default function App() {
  useEffect(() => {
    // Initialize media permissions on app startup (for Electron)
    initializeMediaPermissions().catch(err => {
      console.warn('Media permissions initialization warning:', err);
    });
  }, []);

  return (
    <ThemeProvider>
      <ClientOptionsProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/"                element={<LandingPage />} />
            <Route path="/callback"        element={<CallbackPage />} />
            <Route path="/files-callback"  element={<FilesCallbackPage />} />
            <Route path="/invite/:inviteId" element={<InvitePage />} />
            <Route path="/app/*"           element={
              <ProtectedRoute>
                <AppProvider>
                  <VoiceProvider>
                    <MobileProvider>
                      <AppShell />
                    </MobileProvider>
                  </VoiceProvider>
                </AppProvider>
              </ProtectedRoute>
            } />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </ClientOptionsProvider>
    </ThemeProvider>
  );
}