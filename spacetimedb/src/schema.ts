import { frontierObject, frontierPrivate, frontierView } from './tables';
import { schema, SenderError } from 'spacetimedb/server';
import {
  accessPolicy, playerGrant, appearance, chatMessage, combatEvent, dummyEvent, emoteCooldown, emoteEvent,
  groundItem, inventorySlot, player, playerPos, tickSchedule, trainingDummy, tree, world,
  playStats,
  inviteCode, friend, trade, socialEvent,
  giant, giantContribution, giantEvent,
} from './tables';
import { playerSkill, playerCosmetic, socialPair } from './tables';
import { giantRaid, mentee, mentorStat } from './tables';
import { adventureProfile, expeditionCredit, expedition, expeditionMember, islandProject, gardenShowcase, friendlyDuel, gardenPlot } from './tables';
import { bossConfig, clatterhorn, clatterhornCredit, spireRun, spireMember, spireFight, bossEvent, bossNotice } from './tables';
import { pendingDeposit, dailyActivity, idleState, spectator } from './tables';
import { lanternConfig, lanternRun, lanternMember, lanternFight, lanternPaid } from './tables';

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
  // Appended: a new table (lib/playerStore.ts) at the end.
  playerPos,
  spectator,
  // Appended: Lanternmaw's tables (lib/lantern.ts), new tables only.
  lanternConfig, lanternRun, lanternMember, lanternFight, lanternPaid,
});

/*
 * Spectators are read-only, enforced here once rather than reducer by reducer: every reducer the module registers
 * refuses a spectator identity, so one added later cannot forget to. The lifecycle hooks are registered separately and
 * stay out of this, and procedures are admin-gated (reducers/admin.ts). The tick's scheduler is not a spectator.
 */
type Guarded = { sender: unknown; db: { spectator: { identity: { find(id: unknown): unknown } } } };
const registerReducer = spacetimedb.reducer.bind(spacetimedb) as (...args: unknown[]) => unknown;
(spacetimedb as { reducer: unknown }).reducer = (...args: unknown[]) => {
  const handler = args[args.length - 1] as (ctx: Guarded, params: unknown) => void;
  args[args.length - 1] = (ctx: Guarded, params: unknown) => {
    if (ctx.db.spectator.identity.find(ctx.sender)) throw new SenderError('spectators are read-only');
    return handler(ctx, params);
  };
  return registerReducer(...args);
};
export default spacetimedb;
