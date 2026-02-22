import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import LandingPage  from './pages/LandingPage.jsx';
import CallbackPage from './pages/CallbackPage.jsx';
import AppShell     from './pages/AppShell.jsx';
import { AppProvider } from './context/AppContext.jsx';

function ProtectedRoute({ children }) {
  return localStorage.getItem('jwt') ? children : <Navigate to="/" replace />;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/"         element={<LandingPage />} />
        <Route path="/callback" element={<CallbackPage />} />
        <Route path="/app/*"    element={
          <ProtectedRoute>
            <AppProvider>
              <AppShell />
            </AppProvider>
          </ProtectedRoute>
        } />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}