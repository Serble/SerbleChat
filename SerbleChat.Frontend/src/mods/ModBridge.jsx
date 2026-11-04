import { useLayoutEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../context/AppContext.jsx';
import { useVoice } from '../context/VoiceContext.jsx';
import { useClientOptions } from '../context/ClientOptionsContext.jsx';
import { useTheme } from '../context/ThemeContext.jsx';
import { setContextValue } from './store.js';
import ModSlot from './ModSlot.jsx';

/**
 * Lives inside the app's providers and hands their latest values to mods (api.app.get(),
 * api.voice.get(), ...), so mod code outside React sees what the app sees. Also hosts the
 * "app-overlay" slot, for mods' floating UI.
 */
export default function ModBridge() {
  const app = useApp();
  const voice = useVoice();
  const clientOptions = useClientOptions();
  const theme = useTheme();
  const navigate = useNavigate();

  useLayoutEffect(() => { setContextValue('app', app); }, [app]);
  useLayoutEffect(() => { setContextValue('voice', voice); }, [voice]);
  useLayoutEffect(() => { setContextValue('clientOptions', clientOptions); }, [clientOptions]);
  useLayoutEffect(() => { setContextValue('theme', theme); }, [theme]);
  useLayoutEffect(() => { setContextValue('navigate', navigate); }, [navigate]);

  // Leaving the app (logging out) takes the values with it
  useLayoutEffect(() => () => {
    for (const key of ['app', 'voice', 'navigate']) setContextValue(key, null);
  }, []);

  return <ModSlot name="app-overlay" />;
}
