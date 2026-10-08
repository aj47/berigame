import { create } from 'zustand';

/** U hides every HUD overlay and world label for clean screen recordings. Session only, so a reload brings the HUD back. */
export const HUD_TOGGLE_KEY = 'u';

export const useHudStore = create<{ hidden: boolean; toggle: () => void }>((set) => ({
  hidden: false,
  toggle: () => set((s) => ({ hidden: !s.hidden })),
}));

// hud.css keys off this attribute, so portals and drei <Html> labels outside the React tree hide too.
const apply = (hidden: boolean) => {
  if (typeof document !== 'undefined') document.documentElement.toggleAttribute('data-hud-hidden', hidden);
};
useHudStore.subscribe((s) => apply(s.hidden));
