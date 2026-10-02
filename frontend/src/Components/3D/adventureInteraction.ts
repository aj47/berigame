import type { Ray } from 'three';
import { useUserInputStore } from '../../store';
import { openAdventure, type AdventureView } from '../adventureNavigation';

const interactionLabels: Record<AdventureView, string> = {
  hub: 'Choose an adventure',
  expedition: 'View giant berry adventure',
  market: 'View berry delivery',
  feast: 'Visit the Giant’s feast',
  workshop: 'Help build the workshop',
  gardens: 'Visit island gardens',
  duels: 'Find a friendly duel',
};

export const adventureInteractionLabel = (view: AdventureView) => interactionLabels[view];

/** World props offer both their adventure and the ground underneath the click. */
export function openAdventureInteraction(name: string, event: { clientX: number; clientY: number; ray?: Ray }, view: AdventureView = 'expedition') {
  const select = useUserInputStore.getState().setClickedOtherObject;
  select({ connectionId: name, e: event, dropdownOptions: [{
    label: adventureInteractionLabel(view),
    onClick: () => { select(null); openAdventure(view); },
  }] });
}
