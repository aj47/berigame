import { create } from 'zustand';

/** Player preferences. Persisted per browser; never sent to the server. */
export interface Settings {
  /** 0..1 */
  masterVolume: number;
  /** 0..1, multiplied by masterVolume */
  sfxVolume: number;
  /** 0..1, multiplied by masterVolume (waves, wind) */
  ambientVolume: number;
  muted: boolean;
  /** 'auto' lets the renderer lower resolution on slow devices. */
  graphics: 'auto' | 'high' | 'low';
  showNameplates: boolean;
  /** Multiplier for camera drag/zoom speed, 0.5..2 */
  cameraSensitivity: number;
}

export const DEFAULT_SETTINGS: Settings = {
  masterVolume: 0.8,
  sfxVolume: 1,
  ambientVolume: 0.6,
  muted: false,
  graphics: 'auto',
  showNameplates: true,
  cameraSensitivity: 1,
};

const KEY = 'berigame.settings.v1';

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    // Private windows and blocked storage fall back to defaults.
  }
  return { ...DEFAULT_SETTINGS };
}

interface SettingsState extends Settings {
  set: (patch: Partial<Settings>) => void;
  reset: () => void;
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  ...load(),
  set: (patch) => {
    set(patch);
    try {
      const { set: _s, reset: _r, ...values } = { ...get() };
      localStorage.setItem(KEY, JSON.stringify(values));
    } catch {
      // Ignore storage failures; the setting still applies for this session.
    }
  },
  reset: () => get().set({ ...DEFAULT_SETTINGS }),
}));
