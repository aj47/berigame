import { schema } from 'spacetimedb/server';
import {
  accessPolicy, playerGrant, appearance, chatMessage, combatEvent, dummyEvent, emoteCooldown, emoteEvent,
  groundItem, inventorySlot, player, tickSchedule, trainingDummy, tree, world,
  playStats,
  inviteCode, friend, trade, socialEvent,
} from './tables';

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
  trainingDummy,
  dummyEvent,
  emoteEvent,
  emoteCooldown,
  playStats,
  inviteCode,
  friend,
  trade,
  socialEvent,
});
export default spacetimedb;
