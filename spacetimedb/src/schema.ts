import { frontierObject, frontierPrivate, frontierView } from './tables';
import { schema } from 'spacetimedb/server';
import {
  accessPolicy, playerGrant, appearance, chatMessage, combatEvent, dummyEvent, emoteCooldown, emoteEvent,
  groundItem, inventorySlot, player, tickSchedule, trainingDummy, tree, world,
  playStats,
  inviteCode, friend, trade, socialEvent,
  giant, giantContribution, giantEvent,
} from './tables';
import { playerSkill, playerCosmetic, socialPair } from './tables';
import { giantRaid, mentee, mentorStat } from './tables';
import { adventureProfile, expeditionCredit, expedition, expeditionMember, islandProject, gardenShowcase, friendlyDuel, gardenPlot } from './tables';
import { bossConfig, clatterhorn, clatterhornCredit, spireRun, spireMember, spireFight, bossEvent, bossNotice } from './tables';
import { pendingDeposit, dailyActivity, idleState } from './tables';

export const spacetimedb = schema({
  frontierObject, frontierPrivate, frontierView,
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
  giantRaid,
  mentee,
  mentorStat,
  gardenPlot, adventureProfile, expeditionCredit, expedition, expeditionMember, islandProject, gardenShowcase, friendlyDuel,
  bossConfig, clatterhorn, clatterhornCredit, spireRun, spireMember, spireFight, bossEvent, bossNotice,
  pendingDeposit,
  dailyActivity,
  idleState,
});
export default spacetimedb;
