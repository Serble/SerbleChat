import ReactDOM from 'react-dom/client';
import './hover.css';
import './ui.css';
// Imported eagerly so the PWA install prompt is captured as soon as it fires
import './pwa.js';
import App from './App.jsx';

ReactDOM.createRoot(document.getElementById('root')).render(
  <App />
);
