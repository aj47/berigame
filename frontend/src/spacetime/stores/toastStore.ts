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
    // Longer notices (an invite result) stay up long enough to read.
    timer = setTimeout(() => set({ message: null }), Math.min(7000, Math.max(2500, message.length * 55)));
  },
}));
