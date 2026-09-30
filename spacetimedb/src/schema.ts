import { schema } from 'spacetimedb/server';
import {
  accessPolicy, playerGrant, appearance, chatMessage, combatEvent, dummyEvent, emoteCooldown, emoteEvent,
  groundItem, inventorySlot, player, tickSchedule, trainingDummy, tree, world,
  playStats,
  inviteCode, friend, trade, socialEvent,
  giant, giantContribution, giantEvent,
} from './tables';
import { playerSkill, playerCosmetic, socialPair } from './tables';
import { gardenPlot } from './tables';

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
  giant,
  giantContribution,
  giantEvent,
  playerSkill,
  playerCosmetic,
  socialPair,
  gardenPlot,
});
export default spacetimedb;
