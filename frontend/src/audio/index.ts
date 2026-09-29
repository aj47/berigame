import { useSettingsStore } from '../spacetime/stores/settingsStore';
import { AudioEngine } from './engine';

export type { SfxName } from './synth';

const createContext = () => {
  const Ctor = (window as any).AudioContext ?? (window as any).webkitAudioContext;
  if (!Ctor) throw new Error('no Web Audio');
  return new Ctor({ latencyHint: 'interactive' }) as AudioContext;
};

/** The game's one audio engine. Silent until the first user gesture. */
export const audio = new AudioEngine(createContext);

let installed = false;
/**
 * Wire the engine to the settings store and the page: the first pointer or key
 * press unlocks audio (autoplay policy), later presses on buttons click.
 * Returns an uninstaller. Idempotent.
 */
export function installAudio(): () => void {
  if (installed || typeof window === 'undefined') return () => {};
  installed = true;
  if ((import.meta as any).env?.DEV) (window as any).__berigameAudio = audio;
  const settings = useSettingsStore.getState();
  audio.setVolumes(settings);
  const unsubscribe = useSettingsStore.subscribe((s) => audio.setVolumes(s));
  const onGesture = (e: Event) => {
    audio.unlock();
    const el = e.target as Element | null;
    if (e.type === 'pointerdown' && el?.closest?.('button, [role="button"], [role="menuitem"], .context-action')) audio.play('click', { volume: 0.7 });
  };
  const onVisibility = () => {
    // Don't keep waves playing in a background tab.
    const ctx = audio.ctx;
    if (!ctx) return;
    if (document.hidden) void ctx.suspend().catch(() => {});
    else if (ctx.state === 'suspended') void ctx.resume().catch(() => {});
  };
  window.addEventListener('pointerdown', onGesture, true);
  window.addEventListener('keydown', onGesture, true);
  document.addEventListener('visibilitychange', onVisibility);
  return () => {
    installed = false;
    unsubscribe();
    window.removeEventListener('pointerdown', onGesture, true);
    window.removeEventListener('keydown', onGesture, true);
    document.removeEventListener('visibilitychange', onVisibility);
  };
}
