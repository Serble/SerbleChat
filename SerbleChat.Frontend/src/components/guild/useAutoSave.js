import { useState, useRef, useEffect, useCallback } from 'react';
import { useFlashStatus } from '../ui/index.js';

/**
 * Debounced auto-save. Call `schedule(value)` on every user edit; `save(value)`
 * runs once edits pause for `delay` ms. A change still pending when the
 * component unmounts (tab switched, modal closed) is saved immediately rather
 * than dropped.
 *
 * Returns { status, error, schedule } where status is
 * null | 'saving' | 'saved' | 'error' (suitable for <SaveStatus>).
 */
export default function useAutoSave(save, delay = 600) {
  const [status, flash, setStatus] = useFlashStatus();
  const [error, setError] = useState(null);
  const timerRef   = useRef(null);
  const pendingRef = useRef(null); // { value } while a save is scheduled
  const saveRef    = useRef(save);
  useEffect(() => { saveRef.current = save; });

  const flush = useCallback(async () => {
    clearTimeout(timerRef.current);
    const pending = pendingRef.current;
    if (!pending) return;
    pendingRef.current = null;
    try {
      await saveRef.current(pending.value);
      setError(null);
      // Another edit may have been scheduled while this one was in flight
      if (!pendingRef.current) flash('saved', 2000);
    } catch (e) {
      setError(e.message);
      setStatus('error');
    }
  }, [flash, setStatus]);

  const schedule = useCallback(value => {
    pendingRef.current = { value };
    setStatus('saving');
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(flush, delay);
  }, [flush, delay, setStatus]);

  useEffect(() => () => { flush(); }, [flush]);

  return { status, error, schedule };
}
