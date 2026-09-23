import { useCallback, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { visibleNameplates } from './nameplateLayout';

interface Entry { id: string; priority: number; element: HTMLSpanElement; }
const entries = new Set<Entry>();
let nextCheck = 0;

/** One batched layout pass at 10Hz; no React renders or interleaved layout reads/writes. */
export function useNameplateVisibility(id: string, priority: number) {
  const entry = useRef<Entry>();
  const ref = useCallback((element: HTMLSpanElement | null) => {
    if (entry.current) entries.delete(entry.current);
    entry.current = element ? { id, priority, element } : undefined;
    if (entry.current) entries.add(entry.current);
    nextCheck = 0;
  }, [id, priority]);
  useFrame(({ clock }) => {
    if (entries.values().next().value !== entry.current || clock.elapsedTime < nextCheck) return;
    nextCheck = clock.elapsedTime + .1;
    const current = [...entries];
    const boxes = current.map(({ id: key, priority: rank, element }) => {
      const rect = element.getBoundingClientRect();
      return { id: key, priority: rank, left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
    });
    const visible = visibleNameplates(boxes);
    for (const value of current) {
      const visibility = visible.has(value.id) ? 'visible' : 'hidden';
      if (value.element.style.visibility !== visibility) value.element.style.visibility = visibility;
    }
  });
  return ref;
}
