import { createContext, useContext, useState, useEffect, useRef } from 'react';
import { useTheme } from './ThemeContext.jsx';
import { getClientOptions, setClientOptions } from '../api.js';

// ─── Defaults ─────────────────────────────────────────────────────────────────

export const OPTION_DEFAULTS = {
  messageLinesLimit: 28,
  blockedMessageMode: 'masked', // 'masked' | 'visible' | 'hidden'
};

// ─── Context ──────────────────────────────────────────────────────────────────

const ClientOptionsCtx = createContext(null);

export function ClientOptionsProvider({ children }) {
  const theme = useTheme();

  const [messageLinesLimit, setMsgLimitState] = useState(OPTION_DEFAULTS.messageLinesLimit);
  const [blockedMessageMode, setBlockedModeState] = useState(OPTION_DEFAULTS.blockedMessageMode);

  // Refs so the debounced save callback always has the latest values without
  // needing to be recreated on every render.
  const msgLimitRef        = useRef(OPTION_DEFAULTS.messageLinesLimit);
  const blockedModeRef     = useRef(OPTION_DEFAULTS.blockedMessageMode);
  const themeRef           = useRef({ activeId: theme.activeId, customThemes: theme.customThemes });
  const pendingLoad   = useRef(true);   // skip saves until the initial load is done
  const saveTimerRef  = useRef(null);

  // Keep theme ref in sync with context
  useEffect(() => {
    themeRef.current = { activeId: theme.activeId, customThemes: theme.customThemes };
  }, [theme.activeId, theme.customThemes]);

  // ── Initial load ────────────────────────────────────────────────────────────

  useEffect(() => {
    loadFromBackend();
    return () => clearTimeout(saveTimerRef.current);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function loadFromBackend() {
    try {
      const raw = await getClientOptions();
      // The backend returns a JSON-encoded string → parse once to get the inner
      // options string, then parse again to get the actual options object.
      let parsed = {};
      if (typeof raw === 'string' && raw) {
        try { parsed = JSON.parse(raw); } catch { /* keep defaults */ }
      } else if (raw && typeof raw === 'object') {
        parsed = raw;
      }

      // Apply saved theme state
      if (parsed.theme && typeof parsed.theme === 'object') {
        theme.importState(parsed.theme);
      }

      // Apply other options
      if (typeof parsed.messageLinesLimit === 'number') {
        msgLimitRef.current = parsed.messageLinesLimit;
        setMsgLimitState(parsed.messageLinesLimit);
      }
      if (['masked', 'visible', 'hidden'].includes(parsed.blockedMessageMode)) {
        blockedModeRef.current = parsed.blockedMessageMode;
        setBlockedModeState(parsed.blockedMessageMode);
      }
    } catch (e) {
      console.warn('[ClientOptions] Failed to load from backend:', e);
    } finally {
      // Wait for any React state updates from importState to flush before we
      // start watching for changes (avoids immediately re-saving on first load).
      setTimeout(() => { pendingLoad.current = false; }, 200);
    }
  }

  // ── Save helpers ─────────────────────────────────────────────────────────────

  function scheduleSave() {
    clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      try {
        const payload = JSON.stringify({
          messageLinesLimit: msgLimitRef.current,
          blockedMessageMode: blockedModeRef.current,
          theme: themeRef.current,
        });
        await setClientOptions(payload);
      } catch (e) {
        console.warn('[ClientOptions] Failed to save:', e);
      }
    }, 1000);
  }

  // ── Watch theme changes and persist ─────────────────────────────────────────

  useEffect(() => {
    if (pendingLoad.current) return;
    scheduleSave();
  }, [theme.activeId, theme.customThemes]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Public setters ───────────────────────────────────────────────────────────

  function setMessageLinesLimit(val) {
    const n = Math.max(5, Math.min(200, Number(val) || OPTION_DEFAULTS.messageLinesLimit));
    msgLimitRef.current = n;
    setMsgLimitState(n);
    if (!pendingLoad.current) scheduleSave();
  }

  function setBlockedMessageMode(mode) {
    if (!['masked', 'visible', 'hidden'].includes(mode)) return;
    blockedModeRef.current = mode;
    setBlockedModeState(mode);
    if (!pendingLoad.current) scheduleSave();
  }

  return (
    <ClientOptionsCtx.Provider value={{
      messageLinesLimit,
      setMessageLinesLimit,
      blockedMessageMode,
      setBlockedMessageMode,
    }}>
      {children}
    </ClientOptionsCtx.Provider>
  );
}

export const useClientOptions = () => useContext(ClientOptionsCtx);
