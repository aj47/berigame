import { useEffect } from 'react';

/** Native fragment scrolling happens before a lazy-loaded page has its headings. */
export function useHashAnchor(page: string) {
  useEffect(() => {
    if (!window.location.hash) return;
    let id: string;
    try { id = decodeURIComponent(window.location.hash.slice(1)); }
    catch { return; }
    const frame = requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView());
    return () => cancelAnimationFrame(frame);
  }, [page]);
}
