import { createContext, useContext, useState, useEffect, useCallback } from 'react';

const MobileCtx = createContext(null);

const BREAKPOINT = 768;

/** Keep --app-height and --app-top in sync with the visual viewport.
 *  When the on-screen keyboard opens the visual viewport shrinks and may
 *  scroll up (offsetTop > 0 on iOS), so #root stays exactly within the
 *  visible area with no overflow the user can scroll into. */
function syncAppHeight() {
  const vv = window.visualViewport;
  const h   = vv?.height    ?? window.innerHeight;
  const top = vv?.offsetTop ?? 0;
  document.documentElement.style.setProperty('--app-height', `${h}px`);
  document.documentElement.style.setProperty('--app-top',    `${top}px`);
}

export function MobileProvider({ children }) {
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== 'undefined' && window.innerWidth <= BREAKPOINT
  );
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    // Initial set
    syncAppHeight();

    const onResize = () => {
      const mobile = window.innerWidth <= BREAKPOINT;
      setIsMobile(mobile);
      if (!mobile) setSidebarOpen(false);
      syncAppHeight();
    };

    window.addEventListener('resize', onResize);
    // visualViewport fires separately when the keyboard appears/disappears
    window.visualViewport?.addEventListener('resize', syncAppHeight);
    window.visualViewport?.addEventListener('scroll', syncAppHeight);

    return () => {
      window.removeEventListener('resize', onResize);
      window.visualViewport?.removeEventListener('resize', syncAppHeight);
      window.visualViewport?.removeEventListener('scroll', syncAppHeight);
    };
  }, []);

  const openSidebar  = useCallback(() => setSidebarOpen(true),  []);
  const closeSidebar = useCallback(() => setSidebarOpen(false), []);

  return (
    <MobileCtx.Provider value={{ isMobile, sidebarOpen, openSidebar, closeSidebar }}>
      {children}
    </MobileCtx.Provider>
  );
}

export function useMobile() {
  return useContext(MobileCtx);
}