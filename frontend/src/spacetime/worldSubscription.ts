import { POSITIONED_EVENT_TABLES, globalEventQueries } from './interestSubscription';

/*
 * The connection's static world subscription (connection.ts). The spatial,
 * fast-changing tables are NOT here: player_pos (with its player rows), tree
 * and ground_item come from the interest blocks around you (interestSubscription.ts), plus the rows you
 * need wherever they are, below.
 *
 * Whole tables, and why each is cheap enough to send everyone:
 * - one-row or tiny world state: world, training_dummy, giant, giant_raid,
 *   island_project, boss_config, clatterhorn, spire_run, spire_member;
 * - row-level security already narrows to your own rows: frontier_view,
 *   inventory_slot, invite_code, friend, trade, social_event, garden_plot;
 * - written only on a player's explicit action, never per tick: appearance
 *   and player_cosmetic (every avatar draws them, and narrowing them to the
 *   visible players would need a join the server re-evaluates on every move),
 *   expedition / expedition_member / friendly_duel / garden_showcase (the
 *   Adventure panel lists every crew, duel and shared garden);
 * - chat_message keeps CHAT_KEEP_ROWS (100) lines;
 * - boss_event (lifecycle cues, a few an hour). The place-bound event tables
 *   (combat, dummy, emote, giant) are split by their `cell` column into a
 *   world-wide part here (GLOBAL_CELL) and one query per cell of your player
 *   block (interestSubscription.ts cellGroups).
 */
export const WORLD_TABLES = [
  'world', 'frontierView', 'appearance', 'chatMessage', 'inventorySlot', 'trainingDummy', 'inviteCode', 'friend',
  'trade', 'socialEvent', 'giant', 'playerCosmetic', 'giantRaid', 'gardenPlot', 'expedition',
  'expeditionMember', 'islandProject', 'gardenShowcase', 'friendlyDuel',
  // Bosses: lifecycle rows whole-table; boss_notice narrowed to your own in connection.ts (it has no RLS);
  // spire_fight per run (bosses/spireSubscription.ts).
  'bossConfig', 'clatterhorn', 'spireRun', 'spireMember', 'bossEvent',
] as const;

/** Place-bound event tables: whole-table unless they are in POSITIONED_EVENT_TABLES (a cell column, 0 = global). */
export const PLACE_EVENT_TABLES = ['combat_event', 'dummy_event', 'emote_event', 'giant_event'] as const;

/** SQL queries of the static world subscription: your own rows and the event tables. */
export function worldQueries(positioned: readonly string[] = POSITIONED_EVENT_TABLES): string[] {
  return [
    // Your own row always, even offline or dead, wherever you are.
    'SELECT * FROM player WHERE identity = :sender',
    // ...and its live position while online (the server moves only this row for a step).
    'SELECT * FROM player_pos WHERE identity = :sender',
    // Per-player tables written on every harvest or XP gain: the UI only shows yours.
    'SELECT * FROM player_skill WHERE identity = :sender',
    'SELECT * FROM adventure_profile WHERE identity = :sender',
    // Mentor badges: yours here, your friends' with their rows (interestSubscription.ts).
    'SELECT * FROM mentor_stat WHERE identity = :sender',
    // Your defeat drops, however far away (the bag marker and the goal chip). dropped_by is indexed, so the
    // server evaluates this only for your own piles, not for every pile anyone drops.
    'SELECT * FROM ground_item WHERE dropped_by = :sender AND dropped_on_death = true',
    ...PLACE_EVENT_TABLES.filter((t) => !positioned.includes(t)).map((t) => `SELECT * FROM ${t}`),
    ...globalEventQueries(positioned),
  ];
}
