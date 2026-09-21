import { schema } from 'spacetimedb/server';
import { appearance, chatMessage, combatEvent, groundItem, inventorySlot, player, tickSchedule, tree, world } from './tables';

export const spacetimedb = schema({
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
