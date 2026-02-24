import { createContext, useContext, useState, useEffect, useCallback } from 'react';

// ─── Property definitions ─────────────────────────────────────────────────────
// Each entry: { label, group, var (CSS custom property name) }

export const THEME_PROPS = [
  // Backgrounds
  { key: 'bgBase',      label: 'Chat Background',         group: 'Backgrounds', css: '--bg-base' },
  { key: 'bgSecondary', label: 'Sidebar Background',      group: 'Backgrounds', css: '--bg-secondary' },
  { key: 'bgTertiary',  label: 'Strip Background',        group: 'Backgrounds', css: '--bg-tertiary' },
  { key: 'bgInput',     label: 'Message Input',           group: 'Backgrounds', css: '--bg-input' },
  { key: 'bgHover',     label: 'Hover State',             group: 'Backgrounds', css: '--bg-hover' },
  { key: 'bgActive',    label: 'Selected Item',           group: 'Backgrounds', css: '--bg-active' },
  { key: 'bgOverlay',   label: 'Menu / Modal Background', group: 'Backgrounds', css: '--bg-overlay' },
  { key: 'bgUserPanel', label: 'User Panel Background',   group: 'Backgrounds', css: '--bg-user-panel' },
  // Text
  { key: 'textPrimary',   label: 'Primary Text',   group: 'Text', css: '--text-primary' },
  { key: 'textSecondary', label: 'Secondary Text', group: 'Text', css: '--text-secondary' },
  { key: 'textMuted',     label: 'Muted Text',     group: 'Text', css: '--text-muted' },
  { key: 'textSubtle',    label: 'Subtle Text',    group: 'Text', css: '--text-subtle' },
  { key: 'textLink',      label: 'Link / Mention', group: 'Text', css: '--text-link' },
  // Accent
  { key: 'accent',      label: 'Accent',       group: 'Accent', css: '--accent' },
  { key: 'accentHover', label: 'Accent Hover', group: 'Accent', css: '--accent-hover' },
  // Status
  { key: 'danger',  label: 'Danger',  group: 'Status', css: '--danger' },
  { key: 'success', label: 'Success', group: 'Status', css: '--success' },
  // Border
  { key: 'border', label: 'Border / Divider', group: 'Backgrounds', css: '--border' },
];

// ─── Default built-in themes ──────────────────────────────────────────────────

const DARK = {
  bgBase: '#313338', bgSecondary: '#2b2d31', bgTertiary: '#1e1f22',
  bgInput: '#383a40', bgHover: '#2e3035', bgActive: '#404249',
  bgOverlay: '#111214', bgUserPanel: '#232428', border: '#1e1f22',
  textPrimary: '#f2f3f5', textSecondary: '#dbdee1', textMuted: '#72767d',
  textSubtle: '#4f5660', textLink: '#7c9ef8',
  accent: '#7c3aed', accentHover: '#6d28d9',
  danger: '#ed4245', success: '#23a55a',
};

export const BUILT_IN_THEMES = [
  {
    id: 'dark', name: 'Dark', builtIn: true,
    colors: DARK,
  },
  {
    id: 'midnight', name: 'Midnight', builtIn: true,
    colors: {
      ...DARK,
      bgBase: '#1a1b2e', bgSecondary: '#16213e', bgTertiary: '#0f3460',
      bgInput: '#1f2040', bgHover: '#1f2040', bgActive: '#2a2b4a',
      bgOverlay: '#0d0d1a', bgUserPanel: '#16213e', border: '#0f3460',
      textLink: '#a78bfa', accent: '#5b21b6', accentHover: '#4c1d95',
    },
  },
  {
    id: 'forest', name: 'Forest', builtIn: true,
    colors: {
      ...DARK,
      bgBase: '#1e2a1e', bgSecondary: '#192219', bgTertiary: '#111a11',
      bgInput: '#263526', bgHover: '#223022', bgActive: '#2e442e',
      bgOverlay: '#0e150e', bgUserPanel: '#1a251a', border: '#111a11',
      textLink: '#86efac', accent: '#16a34a', accentHover: '#15803d',
    },
  },
  {
    id: 'crimson', name: 'Crimson', builtIn: true,
    colors: {
      ...DARK,
      bgBase: '#2a1a1a', bgSecondary: '#231515', bgTertiary: '#180e0e',
      bgInput: '#352020', bgHover: '#2e1f1f', bgActive: '#422525',
      bgOverlay: '#120a0a', bgUserPanel: '#1e1212', border: '#180e0e',
      textLink: '#fca5a5', accent: '#dc2626', accentHover: '#b91c1c',
    },
  },
  {
    id: 'light', name: 'Light', builtIn: true,
    colors: {
      bgBase: '#f0f2f5', bgSecondary: '#e3e5e8', bgTertiary: '#d4d7dc',
      bgInput: '#ffffff', bgHover: '#d9dce0', bgActive: '#c9cdd4',
      bgOverlay: '#ffffff', bgUserPanel: '#d4d7dc', border: '#c4c7cd',
      textPrimary: '#060607', textSecondary: '#2e3338', textMuted: '#4f5660',
      textSubtle: '#747f8d', textLink: '#5865f2',
      accent: '#5865f2', accentHover: '#4752c4',
      danger: '#d83c3e', success: '#248046',
    },
  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

const LS_THEMES_KEY = 'serble_custom_themes';
const LS_ACTIVE_KEY = 'serble_active_theme';

function loadCustomThemes() {
  try { return JSON.parse(localStorage.getItem(LS_THEMES_KEY) ?? '[]'); }
  catch { return []; }
}

function saveCustomThemes(themes) {
  localStorage.setItem(LS_THEMES_KEY, JSON.stringify(themes));
}

function applyTheme(colors) {
  const root = document.documentElement;
  for (const prop of THEME_PROPS) {
    root.style.setProperty(prop.css, colors[prop.key] ?? '');
  }
  // Also update the msg-highlight animation to use the accent
  const accent = colors.accent ?? '#7c3aed';
  const style = document.getElementById('msg-highlight-style');
  if (style) {
    style.textContent = `@keyframes msgHighlight {
      0%   { background: ${accent}59; }
      60%  { background: ${accent}33; }
      100% { background: transparent; }
    }
    .msg-highlighted { animation: msgHighlight 2s ease-out forwards; }`;
  }
}

// ─── Context ──────────────────────────────────────────────────────────────────

const ThemeCtx = createContext(null);

export function ThemeProvider({ children }) {
  const [customThemes, setCustomThemes] = useState(loadCustomThemes);
  const [activeId, setActiveId] = useState(
    () => localStorage.getItem(LS_ACTIVE_KEY) ?? 'dark'
  );

  const allThemes = [...BUILT_IN_THEMES, ...customThemes];

  const activeTheme = allThemes.find(t => t.id === activeId) ?? BUILT_IN_THEMES[0];

  // Apply CSS vars whenever active theme changes
  useEffect(() => {
    applyTheme(activeTheme.colors);
  }, [activeTheme]);

  const activateTheme = useCallback((id) => {
    localStorage.setItem(LS_ACTIVE_KEY, id);
    setActiveId(id);
  }, []);

  const createTheme = useCallback((name, baseColors) => {
    const id = `custom_${Date.now()}`;
    const theme = { id, name, builtIn: false, colors: { ...baseColors } };
    setCustomThemes(prev => {
      const next = [...prev, theme];
      saveCustomThemes(next);
      return next;
    });
    return id;
  }, []);

  const updateTheme = useCallback((id, changes) => {
    setCustomThemes(prev => {
      const next = prev.map(t => t.id === id ? { ...t, ...changes } : t);
      saveCustomThemes(next);
      return next;
    });
  }, []);

  const deleteTheme = useCallback((id) => {
    setCustomThemes(prev => {
      const next = prev.filter(t => t.id !== id);
      saveCustomThemes(next);
      return next;
    });
    setActiveId(cur => cur === id ? 'dark' : cur);
  }, []);

  /** Load state from an external source (e.g. backend client-options). */
  const importState = useCallback(({ activeId: id, customThemes: themes } = {}) => {
    if (Array.isArray(themes)) {
      setCustomThemes(themes);
      localStorage.setItem(LS_THEMES_KEY, JSON.stringify(themes));
    }
    if (id) {
      localStorage.setItem(LS_ACTIVE_KEY, id);
      setActiveId(id);
    }
  }, []);

  return (
    <ThemeCtx.Provider value={{
      allThemes, activeTheme, activeId, customThemes,
      activateTheme, createTheme, updateTheme, deleteTheme,
      importState,
    }}>
      {children}
    </ThemeCtx.Provider>
  );
}

export const useTheme = () => useContext(ThemeCtx);
