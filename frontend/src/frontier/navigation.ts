export const FRONTIER_EVENT = 'berigame-settlement';
export type FrontierTab = 'Journal' | 'Land' | 'Build' | 'Craft' | 'Wildlife' | 'Skills' | 'Harbour' | 'Bag' | 'Storage';
/** `storage` preselects a container (a chest's building id) when the Storage tab opens. */
export type FrontierRequest = { tab: FrontierTab; plot?: string; storage?: string };
export function openSettlement(tab: FrontierTab = 'Journal', plot?: string, storage?: string) {
  window.dispatchEvent(new CustomEvent(FRONTIER_EVENT, { detail: { tab, plot, storage } }));
}
