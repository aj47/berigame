import { schema } from 'spacetimedb/server';
import { accessPolicy, playerGrant, appearance, chatMessage, combatEvent, groundItem, inventorySlot, player, tickSchedule, tree, world } from './tables';

export const spacetimedb = schema({
  accessPolicy,
  playerGrant,
  world,
  appearance,
  tickSchedule,
  player,
  inventorySlot,
  groundItem,
  tree,
  chatMessage,
  combatEvent,
});
export default spacetimedb;
