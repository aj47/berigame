import { create } from 'zustand';
import { hitReactionPrefs } from '../../fx/hitReaction';
import { DEFAULT_AMBIENT_VOLUME } from '../../audio/defaults';

/** Player preferences. Persisted per browser; never sent to the server. */
export interface Settings {
  /** 0..1 */
  masterVolume: number;
  /** 0..1, multiplied by masterVolume */
  sfxVolume: number;
  /** 0..1, multiplied by masterVolume (waves, wind) */
  ambientVolume: number;
  muted: boolean;
  /** Render quality tier (renderQuality.ts); 'auto' picks one for the device and frame rate. */
  graphics: 'auto' | 'low' | 'medium' | 'high';
  showNameplates: boolean;
  showWorldLabels: boolean;
  showGuidance: boolean;
  /** Clicking an attackable target approaches and attacks; holding opens its menu. */
  oneClickAttack: boolean;
  /** Multiplier for camera drag/zoom speed, 0.5..2 */
  cameraSensitivity: number;
  /** Mouse button that drags the camera around; right drag always rotates. */
  cameraRotateButton: 'right' | 'left';
  /** Skip knockback, hitstop and fleeing wildlife bursts. Defaults to the OS preference. */
  reduceMotion: boolean;
}

const prefersReduced = (): boolean => {
  try { return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
};

export const DEFAULT_SETTINGS: Settings = {
  masterVolume: 0.8,
  sfxVolume: 1,
  ambientVolume: DEFAULT_AMBIENT_VOLUME,
  muted: false,
  graphics: 'auto',
  showNameplates: true,
  showWorldLabels: true,
  showGuidance: true,
  oneClickAttack: false,
  cameraSensitivity: 1,
  cameraRotateButton: 'right',
  reduceMotion: prefersReduced(),
};

const KEY = 'berigame.settings.v1';
const AMBIENT_DEFAULT_VERSION = 1;

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const { ambientDefaultVersion, ...saved } = JSON.parse(raw);
      // Older saves included all defaults even when only another setting changed.
      // Adopt the quieter default once; later explicit selections of 60% persist.
      if (ambientDefaultVersion === undefined && saved.ambientVolume === 0.6) {
        saved.ambientVolume = DEFAULT_AMBIENT_VOLUME;
      }
      return { ...DEFAULT_SETTINGS, ...saved };
    }
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
      localStorage.setItem(KEY, JSON.stringify({ ...values, ambientDefaultVersion: AMBIENT_DEFAULT_VERSION }));
    } catch {
      // Ignore storage failures; the setting still applies for this session.
    }
  },
  reset: () => get().set({ ...DEFAULT_SETTINGS }),
}));

// Presentation code reads this every frame without subscribing.
hitReactionPrefs.reduced = useSettingsStore.getState().reduceMotion;
useSettingsStore.subscribe((s) => { hitReactionPrefs.reduced = s.reduceMotion; });
