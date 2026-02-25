import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import LandingPage  from './pages/LandingPage.jsx';
import CallbackPage from './pages/CallbackPage.jsx';
import AppShell     from './pages/AppShell.jsx';
import InvitePage   from './pages/InvitePage.jsx';
import { AppProvider } from './context/AppContext.jsx';
import { ThemeProvider } from './context/ThemeContext.jsx';
import { ClientOptionsProvider } from './context/ClientOptionsContext.jsx';
import { MobileProvider } from './context/MobileContext.jsx';

function ProtectedRoute({ children }) {
  return localStorage.getItem('jwt') ? children : <Navigate to="/" replace />;
}

export default function App() {
  return (
    <ThemeProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/"                element={<LandingPage />} />
          <Route path="/callback"        element={<CallbackPage />} />
          <Route path="/invite/:inviteId" element={<InvitePage />} />
          <Route path="/app/*"           element={
            <ProtectedRoute>
              <AppProvider>
                <ClientOptionsProvider>
                  <MobileProvider>
                    <AppShell />
                  </MobileProvider>
                </ClientOptionsProvider>
              </AppProvider>
            </ProtectedRoute>
          } />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </ThemeProvider>
  );
}