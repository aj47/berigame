import { create } from 'zustand';

interface ToastState {
  message: string | null;
  show: (message: string) => void;
}

let timer: ReturnType<typeof setTimeout> | null = null;

/** One-line feedback for rejected actions ("tree is regrowing", "slow down"). */
export const useToastStore = create<ToastState>((set) => ({
  message: null,
  show: (message) => {
    set({ message });
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => set({ message: null }), 2500);
  },
}));
