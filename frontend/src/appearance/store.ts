import { create } from 'zustand';
import type { Appearance } from '@sim';

/** Unsaved wardrobe preview, only applied to the local player's rendering. */
export const useAppearancePreview = create<{
  draft: Appearance | null;
  setDraft: (draft: Appearance | null) => void;
}>((set) => ({ draft: null, setDraft: (draft) => set({ draft }) }));
