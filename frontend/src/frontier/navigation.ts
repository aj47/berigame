export const FRONTIER_EVENT = 'berigame-settlement';
export type FrontierTab = 'Journal' | 'Land' | 'Build' | 'Craft' | 'Wildlife' | 'Skills' | 'Harbour' | 'Bag';
export type FrontierRequest = { tab: FrontierTab; plot?: string };
export function openSettlement(tab: FrontierTab = 'Journal', plot?: string) {
  window.dispatchEvent(new CustomEvent(FRONTIER_EVENT, { detail: { tab, plot } }));
}
