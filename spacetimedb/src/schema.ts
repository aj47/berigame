import { schema } from 'spacetimedb/server';
import { chatMessage, combatEvent, groundItem, inventorySlot, player, tickSchedule, tree, world } from './tables';

export const spacetimedb = schema({
  world,
  tickSchedule,
  player,
  inventorySlot,
  groundItem,
  tree,
  chatMessage,
  combatEvent,
});
export default spacetimedb;
