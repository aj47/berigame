import { useLoadingStore } from '../store';
import { WorldLiveness } from './worldLiveness';

const health = new WorldLiveness();
function publishHealth() {
  const state = useLoadingStore.getState();
  if (state.worldUpdatesStalled !== health.stalled) state.setWorldUpdatesStalled(health.stalled);
}
/** Called from existing table events. Healthy ticks cause no store writes. */
export function observeWorldDelivery(tick: number) {
  health.observeTick(tick, performance.now());
  publishHealth();
}
/** One lightweight timer and lifecycle listeners for the whole connection. */
export function startWorldLivenessMonitor() {
  const connected = () => health.setConnected(useLoadingStore.getState().websocketConnected, performance.now());
  const network = () => { health.setOnline(navigator.onLine); publishHealth(); };
  const visibility = () => health.setVisible(document.visibilityState !== 'hidden', performance.now());
  const suspend = () => health.setVisible(false, performance.now());
  const resume = () => { visibility(); network(); };
  connected(); visibility(); network();
  const unsubscribe = useLoadingStore.subscribe(connected);
  window.addEventListener('offline', network);
  window.addEventListener('online', network);
  window.addEventListener('focus', resume);
  window.addEventListener('pageshow', resume);
  document.addEventListener('visibilitychange', visibility);
  document.addEventListener('freeze', suspend);
  document.addEventListener('resume', resume);
  const interval = window.setInterval(() => { health.check(performance.now()); publishHealth(); }, 1000);
  return () => {
    unsubscribe(); window.clearInterval(interval);
    window.removeEventListener('offline', network); window.removeEventListener('online', network);
    window.removeEventListener('focus', resume); window.removeEventListener('pageshow', resume);
    document.removeEventListener('visibilitychange', visibility);
    document.removeEventListener('freeze', suspend); document.removeEventListener('resume', resume);
  };
}
