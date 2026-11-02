import { createContext, useContext, useState, useEffect, useRef } from 'react';
import { useTheme } from './ThemeContext.jsx';
import { getClientOptions, setClientOptions } from '../api.js';
import { setDateFormatPrefs, isTimeFormat, isDateFormat } from '../dateFormat.js';

// The date/time formats are also cached here, so the first paint uses them
// before the synced options arrive from the server
const LS_DATE_TIME_KEY = 'serbleChat_dateTimeFormat';
function cachedDateTimeFormat() {
  try {
    const v = JSON.parse(localStorage.getItem(LS_DATE_TIME_KEY) ?? '{}');
    return { time: isTimeFormat(v.time) ? v.time : 'auto', date: isDateFormat(v.date) ? v.date : 'auto' };
  } catch {
    return { time: 'auto', date: 'auto' };
  }
}

// ─── Defaults ─────────────────────────────────────────────────────────────────

export const OPTION_DEFAULTS = {
  messageLinesLimit: 28,
  blockedMessageMode: 'masked', // 'masked' | 'visible' | 'hidden'
  sendTypingIndicators: true, // whether to send typing notifications
  timeFormat: 'auto', // 'auto' | '12h' | '24h'
  dateFormat: 'auto', // 'auto' | 'DD/MM/YYYY' | 'DD/MM/YY' | 'MM/DD/YYYY' | 'MM/DD/YY' | 'YYYY/MM/DD
  voiceParticipantSettings: {}, // { [participantIdentity]: { muted: boolean, volume: number } }
  voiceAudioOptions: {
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
    voiceIsolation: false,
    rnnoise: true,
    micVolume: 100, // 0-200, default 100 (100% = normal)
    inputMode: 'voice-activity', // 'voice-activity' | 'push-to-talk'
    speakingThreshold: 10, // 0-100, default 10
  },
  pushToTalkKey: 'Control+Shift+T', // Default PTT key
  keybinds: {
    toggleMute: 'CommandOrControl+Shift+M',
    toggleDeafen: 'CommandOrControl+Shift+D',
    pushToTalk: 'Control+Shift+T',
  },
  // Local device settings (Electron only - stored in localStorage, not synced to server)
  localDeviceSettings: {
    inputDeviceId: 'default',
    outputDeviceId: 'default',
    cameraDeviceId: 'default',
  },
};

// ─── Context ──────────────────────────────────────────────────────────────────

const ClientOptionsCtx = createContext(null);

export function ClientOptionsProvider({ children }) {
  const theme = useTheme();

  const [messageLinesLimit, setMsgLimitState] = useState(OPTION_DEFAULTS.messageLinesLimit);
  const [blockedMessageMode, setBlockedModeState] = useState(OPTION_DEFAULTS.blockedMessageMode);
  const [sendTypingIndicators, setSendTypingIndicatorsState] = useState(OPTION_DEFAULTS.sendTypingIndicators);
  const [timeFormat, setTimeFormatState] = useState(() => cachedDateTimeFormat().time);
  const [dateFormat, setDateFormatState] = useState(() => cachedDateTimeFormat().date);
  // Set during render (not in an effect) so children rendering in this same pass use the new format
  setDateFormatPrefs(timeFormat, dateFormat);
  const [voiceParticipantSettings, setVoiceParticipantSettingsState] = useState(OPTION_DEFAULTS.voiceParticipantSettings);
  const [voiceAudioOptions, setVoiceAudioOptionsState] = useState(OPTION_DEFAULTS.voiceAudioOptions);
  const [keybinds, setKeybindsState] = useState(OPTION_DEFAULTS.keybinds);
  const [localDeviceSettings, setLocalDeviceSettingsState] = useState(OPTION_DEFAULTS.localDeviceSettings);

  // Refs so the debounced save callback always has the latest values without
  // needing to be recreated on every render.
  const msgLimitRef        = useRef(OPTION_DEFAULTS.messageLinesLimit);
  const blockedModeRef     = useRef(OPTION_DEFAULTS.blockedMessageMode);
  const sendTypingIndicatorsRef = useRef(OPTION_DEFAULTS.sendTypingIndicators);
  const timeFormatRef      = useRef(timeFormat);
  const dateFormatRef      = useRef(dateFormat);
  const voiceSettingsRef   = useRef(OPTION_DEFAULTS.voiceParticipantSettings);
  const voiceAudioOptionsRef = useRef(OPTION_DEFAULTS.voiceAudioOptions);
  const keybindsRef        = useRef(OPTION_DEFAULTS.keybinds);
  const localDeviceSettingsRef = useRef(OPTION_DEFAULTS.localDeviceSettings);
  const themeRef           = useRef({ activeId: theme.activeId, customThemes: theme.customThemes });
  const pendingLoad   = useRef(true);   // skip saves until the initial load is done
  const saveTimerRef  = useRef(null);
  const loadDoneRef   = useRef(false);  // guard against double-invoke

  // Keep theme ref in sync with context
  useEffect(() => {
    themeRef.current = { activeId: theme.activeId, customThemes: theme.customThemes };
  }, [theme.activeId, theme.customThemes]);

  // ── Initial load ────────────────────────────────────────────────────────────

  useEffect(() => {
    loadFromBackend();
    loadLocalDeviceSettings();
    return () => clearTimeout(saveTimerRef.current);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Load local device settings from localStorage (Electron only)
  function loadLocalDeviceSettings() {
    try {
      const saved = localStorage.getItem('serbleChat_localDeviceSettings');
      if (saved) {
        const parsed = JSON.parse(saved);
        localDeviceSettingsRef.current = { ...OPTION_DEFAULTS.localDeviceSettings, ...parsed };
        setLocalDeviceSettingsState(localDeviceSettingsRef.current);
      }
    } catch (e) {
      console.warn('[ClientOptions] Failed to load local device settings:', e);
    }
  }

  // Save local device settings to localStorage (separate from server sync)
  function saveLocalDeviceSettings() {
    try {
      localStorage.setItem('serbleChat_localDeviceSettings', JSON.stringify(localDeviceSettingsRef.current));
    } catch (e) {
      console.warn('[ClientOptions] Failed to save local device settings:', e);
    }
  }

  async function loadFromBackend() {
    if (loadDoneRef.current) return;
    loadDoneRef.current = true;
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
      if (typeof parsed.sendTypingIndicators === 'boolean') {
        sendTypingIndicatorsRef.current = parsed.sendTypingIndicators;
        setSendTypingIndicatorsState(parsed.sendTypingIndicators);
      }
      if (isTimeFormat(parsed.timeFormat)) {
        timeFormatRef.current = parsed.timeFormat;
        setTimeFormatState(parsed.timeFormat);
      }
      if (isDateFormat(parsed.dateFormat)) {
        dateFormatRef.current = parsed.dateFormat;
        setDateFormatState(parsed.dateFormat);
      }
      cacheDateTimeFormat();
      if (parsed.voiceParticipantSettings && typeof parsed.voiceParticipantSettings === 'object') {
        voiceSettingsRef.current = parsed.voiceParticipantSettings;
        setVoiceParticipantSettingsState(parsed.voiceParticipantSettings);
      }
      if (parsed.voiceAudioOptions && typeof parsed.voiceAudioOptions === 'object') {
        // Merge over defaults so options added after the user last saved still have values
        voiceAudioOptionsRef.current = { ...OPTION_DEFAULTS.voiceAudioOptions, ...parsed.voiceAudioOptions };
        setVoiceAudioOptionsState(voiceAudioOptionsRef.current);
      }
      if (parsed.keybinds && typeof parsed.keybinds === 'object') {
        keybindsRef.current = { ...OPTION_DEFAULTS.keybinds, ...parsed.keybinds };
        setKeybindsState(keybindsRef.current);
        
        // Sync to Electron if running in Electron
        if (typeof window !== 'undefined' && window.electron?.setKeybinds) {
          window.electron.setKeybinds(keybindsRef.current).catch(e => {
            console.warn('[ClientOptions] Failed to sync keybinds to Electron:', e);
          });
        }
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
          sendTypingIndicators: sendTypingIndicatorsRef.current,
          timeFormat: timeFormatRef.current,
          dateFormat: dateFormatRef.current,
          voiceParticipantSettings: voiceSettingsRef.current,
          voiceAudioOptions: voiceAudioOptionsRef.current,
          keybinds: keybindsRef.current,
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

  function setSendTypingIndicators(enabled) {
    const val = !!enabled;
    sendTypingIndicatorsRef.current = val;
    setSendTypingIndicatorsState(val);
    if (!pendingLoad.current) scheduleSave();
  }

  function cacheDateTimeFormat() {
    try {
      localStorage.setItem(LS_DATE_TIME_KEY, JSON.stringify({ time: timeFormatRef.current, date: dateFormatRef.current }));
    } catch { /* private mode etc.: the synced copy still works */ }
  }

  function setTimeFormat(value) {
    if (!isTimeFormat(value)) return;
    timeFormatRef.current = value;
    setTimeFormatState(value);
    cacheDateTimeFormat();
    if (!pendingLoad.current) scheduleSave();
  }

  function setDateFormat(value) {
    if (!isDateFormat(value)) return;
    dateFormatRef.current = value;
    setDateFormatState(value);
    cacheDateTimeFormat();
    if (!pendingLoad.current) scheduleSave();
  }

  function setVoiceParticipantSetting(participantIdentity, setting) {
    const current = voiceSettingsRef.current[participantIdentity] || { muted: false, volume: 1 };
    const updated = { ...current, ...setting };
    
    // Remove if both are defaults
    if (!updated.muted && updated.volume === 1) {
      const newSettings = { ...voiceSettingsRef.current };
      delete newSettings[participantIdentity];
      voiceSettingsRef.current = newSettings;
      setVoiceParticipantSettingsState(newSettings);
    } else {
      voiceSettingsRef.current = { ...voiceSettingsRef.current, [participantIdentity]: updated };
      setVoiceParticipantSettingsState(voiceSettingsRef.current);
    }
    
    if (!pendingLoad.current) scheduleSave();
  }

  function getVoiceParticipantSetting(participantIdentity) {
    return voiceSettingsRef.current[participantIdentity] || { muted: false, volume: 1 };
  }

  function setVoiceAudioOption(optionName, value) {
    const valid = ['echoCancellation', 'noiseSuppression', 'autoGainControl', 'voiceIsolation', 'rnnoise', 'micVolume', 'inputMode'];
    if (!valid.includes(optionName)) return;
    
    // Clamp micVolume to 0-200 range
    if (optionName === 'micVolume') {
      const n = Number(value);
      value = Number.isFinite(n) ? Math.max(0, Math.min(200, n)) : 100;
    }
    
    // Validate inputMode
    if (optionName === 'inputMode' && !['voice-activity', 'push-to-talk'].includes(value)) {
      return;
    }
    
    voiceAudioOptionsRef.current = { ...voiceAudioOptionsRef.current, [optionName]: value };
    setVoiceAudioOptionsState(voiceAudioOptionsRef.current);
    if (!pendingLoad.current) scheduleSave();
  }

  function setKeybinds(newKeybinds) {
    keybindsRef.current = { ...keybindsRef.current, ...newKeybinds };
    setKeybindsState(keybindsRef.current);
    
    // Sync to Electron
    if (typeof window !== 'undefined' && window.electron?.setKeybinds) {
      window.electron.setKeybinds(keybindsRef.current).catch(e => {
        console.warn('[ClientOptions] Failed to sync keybinds to Electron:', e);
      });
    }
    
    if (!pendingLoad.current) scheduleSave();
  }

  function setLocalDeviceSetting(setting) {
    localDeviceSettingsRef.current = { ...localDeviceSettingsRef.current, ...setting };
    setLocalDeviceSettingsState(localDeviceSettingsRef.current);
    saveLocalDeviceSettings();
  }

  return (
    <ClientOptionsCtx.Provider value={{
      messageLinesLimit,
      setMessageLinesLimit,
      blockedMessageMode,
      setBlockedMessageMode,
      sendTypingIndicators,
      setSendTypingIndicators,
      timeFormat,
      setTimeFormat,
      dateFormat,
      setDateFormat,
      voiceParticipantSettings,
      setVoiceParticipantSetting,
      getVoiceParticipantSetting,
      voiceAudioOptions,
      setVoiceAudioOption,
      keybinds,
      setKeybinds,
      localDeviceSettings,
      setLocalDeviceSetting,
    }}>
      {children}
    </ClientOptionsCtx.Provider>
  );
}

export const useClientOptions = () => useContext(ClientOptionsCtx);