export const ADVENTURE_VIEWS = ['hub', 'expedition', 'market', 'feast', 'workshop', 'gardens', 'duels'] as const;
export type AdventureView = typeof ADVENTURE_VIEWS[number];
export const ADVENTURE_EVENT = 'berigame-adventure';

/** World interactions open the activity they describe. */
export function openAdventure(view: AdventureView = 'hub') {
  window.dispatchEvent(new CustomEvent(ADVENTURE_EVENT, { detail: { view } }));
}
