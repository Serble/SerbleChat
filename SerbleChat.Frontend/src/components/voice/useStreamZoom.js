import { useCallback, useEffect, useRef, useState } from 'react';

const MIN_SCALE = 1;
const MAX_SCALE = 8;
const DOUBLE_CLICK_SCALE = 2.5;
// How long a click waits to see whether it's the first half of a double-click
const CLICK_DELAY_MS = 250;
// Pointer movement past this counts as a drag, not a click
const DRAG_THRESHOLD_PX = 4;

const IDENTITY = { s: 1, x: 0, y: 0 };

/**
 * Zoom and pan for a stream or an image: the mouse wheel zooms towards the cursor, dragging
 * pans once zoomed in, two fingers pinch, and a double-click zooms in on that spot (or back out).
 *
 * The transform goes on `videoEl` (a <video> or an <img>), which fills `containerRef`'s
 * element. Everything is in that element's pixels, with the origin at its top-left corner,
 * and the picture is never pulled so far that one of its edges comes away from the side of
 * the box. The picture is wherever the element draws it: inside its padding, with
 * `object-fit: contain`, or `scale-down` (never bigger than its own size).
 *
 * `handleClick(action)` runs a single click's action (e.g. leaving the expanded view) only
 * once it's clear the click wasn't a drag, the start of a double-click, or made while zoomed.
 * Pass `{ delay: false }` to run it straight away when a double-click doesn't matter.
 */
export function useStreamZoom(containerRef, videoEl, enabled) {
  const [view, setView] = useState(IDENTITY);
  const viewRef = useRef(view);
  viewRef.current = view;
  const draggedRef = useRef(false);
  const clickTimerRef = useRef(null);

  const videoRef = useRef(videoEl);
  videoRef.current = videoEl;

  /** Where the picture sits in the box when unzoomed: { w, h, left, top, cw, ch }. */
  const contentRect = useCallback(() => {
    const el = containerRef.current;
    const w = el?.clientWidth ?? 0;
    const h = el?.clientHeight ?? 0;
    const media = videoRef.current;
    let padL = 0, padR = 0, padT = 0, padB = 0, fit = 'contain';
    if (media) {
      const cs = getComputedStyle(media);
      padL = parseFloat(cs.paddingLeft) || 0;
      padR = parseFloat(cs.paddingRight) || 0;
      padT = parseFloat(cs.paddingTop) || 0;
      padB = parseFloat(cs.paddingBottom) || 0;
      fit = cs.objectFit;
    }
    const iw = Math.max(0, w - padL - padR);
    const ih = Math.max(0, h - padT - padB);
    // The picture inside the box (object-fit: contain leaves bars along one side)
    let cw = iw;
    let ch = ih;
    const vw = media?.videoWidth || media?.naturalWidth;
    const vh = media?.videoHeight || media?.naturalHeight;
    if (vw > 0 && vh > 0 && iw > 0 && ih > 0) {
      if (vw / vh > iw / ih) ch = iw * vh / vw;
      else cw = ih * vw / vh;
      // scale-down: small pictures stay their own size
      if (fit === 'scale-down' && cw > vw) {
        cw = vw;
        ch = vh;
      }
    }
    return { w, h, cw, ch, left: padL + (iw - cw) / 2, top: padT + (ih - ch) / 2 };
  }, [containerRef]);

  const clampView = useCallback((s, x, y) => {
    const { w, h, cw, ch, left, top } = contentRect();
    const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));
    // Along a side the zoomed picture fills, keep its edges outside the box; along one it
    // doesn't fill yet, keep it centred
    const axis = (pos, box, start, size) => (scale * size >= box
      ? Math.min(-scale * start, Math.max(box - scale * (start + size), pos))
      : (box - scale * size) / 2 - scale * start);
    return { s: scale, x: axis(x, w, left, cw), y: axis(y, h, top, ch) };
  }, [contentRect]);

  /** Scales by `factor` keeping the point (px, py) where it is, after moving by (dx, dy). */
  const zoomAt = useCallback((factor, px, py, dx = 0, dy = 0) => {
    setView(v => {
      const s = Math.min(MAX_SCALE, Math.max(MIN_SCALE, v.s * factor));
      const r = s / v.s;
      const x = v.x + dx;
      const y = v.y + dy;
      return clampView(s, px - (px - x) * r, py - (py - y) * r);
    });
  }, [clampView]);

  const reset = useCallback(() => setView(IDENTITY), []);

  const zoomBy = useCallback((factor) => {
    const el = containerRef.current;
    if (!el) return;
    zoomAt(factor, el.clientWidth / 2, el.clientHeight / 2);
  }, [containerRef, zoomAt]);

  // Leaving the expanded view (or the stream changing) starts the next one unzoomed
  useEffect(() => {
    if (!enabled) setView(IDENTITY);
  }, [enabled, videoEl]);

  useEffect(() => () => clearTimeout(clickTimerRef.current), []);

  // Draw it
  useEffect(() => {
    if (!videoEl) return;
    if (!enabled || view.s === 1) {
      videoEl.style.transform = '';
      return;
    }
    videoEl.style.transformOrigin = '0 0';
    videoEl.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.s})`;
  }, [videoEl, enabled, view]);

  // Keep the video inside the box when the box shrinks (window resized, fullscreen exited)
  useEffect(() => {
    const el = containerRef.current;
    if (!el || !enabled) return;
    const observer = new ResizeObserver(() => setView(v => clampView(v.s, v.x, v.y)));
    observer.observe(el);
    return () => observer.disconnect();
  }, [containerRef, enabled, clampView]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || !enabled) return;

    const pointers = new Map();
    let last = null; // { cx, cy, dist } of the previous move
    let start = null; // where the gesture began, for telling drags from clicks

    const local = (e) => {
      const r = el.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const gesture = () => {
      const pts = [...pointers.values()];
      const cx = pts.reduce((a, p) => a + p.x, 0) / pts.length;
      const cy = pts.reduce((a, p) => a + p.y, 0) / pts.length;
      const dist = pts.length >= 2 ? Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) : 0;
      return { cx, cy, dist };
    };

    function onWheel(e) {
      e.preventDefault();
      const p = local(e);
      // Trackpad pinches arrive as wheel events with ctrlKey and small deltas: zoom them faster
      const speed = e.ctrlKey ? 0.01 : 0.0015;
      const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      zoomAt(Math.exp(-delta * speed), p.x, p.y);
    }

    function onPointerDown(e) {
      if (e.button !== undefined && e.button !== 0 && e.pointerType === 'mouse') return;
      pointers.set(e.pointerId, local(e));
      if (pointers.size === 1) {
        start = local(e);
        draggedRef.current = false;
      }
      last = gesture();
    }

    function onPointerMove(e) {
      if (!pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, local(e));
      const g = gesture();
      if (start && Math.hypot(g.cx - start.x, g.cy - start.y) > DRAG_THRESHOLD_PX) draggedRef.current = true;
      if (pointers.size >= 2 && last?.dist > 0) {
        zoomAt(g.dist / last.dist, g.cx, g.cy, g.cx - last.cx, g.cy - last.cy);
      } else if (pointers.size === 1 && viewRef.current.s > 1 && last) {
        // Capture once it's really a pan, so the drag keeps going outside the box
        if (draggedRef.current && !el.hasPointerCapture?.(e.pointerId)) el.setPointerCapture?.(e.pointerId);
        const dx = g.cx - last.cx;
        const dy = g.cy - last.cy;
        setView(v => clampView(v.s, v.x + dx, v.y + dy));
      }
      last = g;
    }

    function onPointerUp(e) {
      pointers.delete(e.pointerId);
      last = pointers.size ? gesture() : null;
      if (pointers.size === 0) start = null;
    }

    function onDoubleClick(e) {
      e.preventDefault();
      e.stopPropagation();
      clearTimeout(clickTimerRef.current);
      const p = local(e);
      if (viewRef.current.s > 1.01) setView(IDENTITY);
      else zoomAt(DOUBLE_CLICK_SCALE / viewRef.current.s, p.x, p.y);
    }

    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('pointerdown', onPointerDown);
    el.addEventListener('pointermove', onPointerMove);
    el.addEventListener('pointerup', onPointerUp);
    el.addEventListener('pointercancel', onPointerUp);
    el.addEventListener('dblclick', onDoubleClick);
    return () => {
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('pointerdown', onPointerDown);
      el.removeEventListener('pointermove', onPointerMove);
      el.removeEventListener('pointerup', onPointerUp);
      el.removeEventListener('pointercancel', onPointerUp);
      el.removeEventListener('dblclick', onDoubleClick);
    };
  }, [containerRef, enabled, zoomAt, clampView]);

  const handleClick = useCallback((action, { delay = true } = {}) => {
    if (draggedRef.current) {
      draggedRef.current = false;
      return;
    }
    if (viewRef.current.s > 1.01) return;
    clearTimeout(clickTimerRef.current);
    if (delay) clickTimerRef.current = setTimeout(action, CLICK_DELAY_MS);
    else action();
  }, []);

  /** Whether a point on screen is over the picture (rather than the bars or padding around it). */
  const isOnContent = useCallback((clientX, clientY) => {
    const el = containerRef.current;
    if (!el) return false;
    const r = el.getBoundingClientRect();
    const { cw, ch, left, top } = contentRect();
    const v = viewRef.current;
    const px = (clientX - r.left - v.x) / v.s;
    const py = (clientY - r.top - v.y) / v.s;
    return px >= left && px <= left + cw && py >= top && py <= top + ch;
  }, [containerRef, contentRect]);

  return {
    scale: view.s,
    zoomed: view.s > 1.01,
    zoomIn: () => zoomBy(1.5),
    zoomOut: () => zoomBy(1 / 1.5),
    reset,
    handleClick,
    isOnContent,
  };
}
