export interface NameplateBounds {
  id: string;
  priority: number;
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** Stable priority avoids labels flickering as overlapping avatars reorder. */
export function visibleNameplates(boxes: NameplateBounds[]): Set<string> {
  const accepted: NameplateBounds[] = [];
  for (const box of [...boxes].sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id))) {
    if (!accepted.some(other => box.left < other.right + 3 && box.right + 3 > other.left && box.top < other.bottom + 3 && box.bottom + 3 > other.top)) accepted.push(box);
  }
  return new Set(accepted.map(box => box.id));
}
