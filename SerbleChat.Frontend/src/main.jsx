import ReactDOM from 'react-dom/client';
import './hover.css';
import './ui.css';
// Imported eagerly so the PWA install prompt is captured as soon as it fires
import './pwa.js';
import App from './App.jsx';
import { loadMods } from './mods/loader.js';

// Client mods (desktop app only) start before the app renders, so they can set things up first
loadMods()
  .catch(err => console.error('[mods] Failed to load mods:', err))
  .finally(() => {
    ReactDOM.createRoot(document.getElementById('root')).render(
      <App />
    );
  });
