import { useState, useRef, useEffect, useCallback } from 'react';

/**
 * A status value that clears itself after a delay.
 * `flash(value, ms)` sets it and schedules the reset; `set(value)` sets it
 * without a timeout (e.g. for 'saving').
 */
export function useFlashStatus() {
  const [status, setStatus] = useState(null);
  const timerRef = useRef(null);

  useEffect(() => () => clearTimeout(timerRef.current), []);

  const set = useCallback(value => {
    clearTimeout(timerRef.current);
    setStatus(value);
  }, []);

  const flash = useCallback((value, ms = 2500) => {
    clearTimeout(timerRef.current);
    setStatus(value);
    timerRef.current = setTimeout(() => setStatus(null), ms);
  }, []);

  return [status, flash, set];
}
