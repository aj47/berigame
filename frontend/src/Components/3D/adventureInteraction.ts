import type { Ray } from 'three';
import { useUserInputStore } from '../../store';
import { openAdventure } from '../AdventurePanel';

/** World props offer both their adventure and the ground underneath the click. */
export function openAdventureInteraction(name: string, event: { clientX: number; clientY: number; ray?: Ray }) {
  const select = useUserInputStore.getState().setClickedOtherObject;
  select({ connectionId: name, e: event, dropdownOptions: [{
    label: 'Open Adventure',
    onClick: () => { select(null); openAdventure(); },
  }] });
}
