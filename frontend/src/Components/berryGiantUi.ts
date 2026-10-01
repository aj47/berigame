import type { Expedition } from '../module_bindings/types';

export function berryGiantMood(e: Pick<Expedition, 'giantUntil' | 'baitUntil' | 'hiddenUntil'>, tick: number) {
  if (tick < e.giantUntil) return { label: 'resting', speech: 'Mmm… just a little rest.', until: e.giantUntil };
  if (tick < e.baitUntil) return { label: 'following bait', speech: 'Ooh… something tasty over there!', until: e.baitUntil };
  if (tick < e.hiddenUntil) return { label: 'searching', speech: 'Where did that big berry go?', until: e.hiddenUntil };
  return { label: 'following the berry', speech: 'Sniff… big berry. So hungry!', until: 0 };
}
