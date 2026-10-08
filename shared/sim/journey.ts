/**
 * The journey: the island's progression as five chapters in map order, from the
 * Grove to the Sunken Spire. The goal chip says what to do right now; the map
 * shows the same road as chapters, so both always agree: a chapter's place is a
 * landmark, and the current chapter is the one the chip's goal belongs to.
 */
import { CLATTER_HOME, SPIRE_GATE } from './bossZones';
import type { GoalBosses, GoalStepId } from './goals';
import { Cosmetic, hasCosmetic } from './skills';
import type { Tile } from './types';

export type JourneyChapterId = 'grove' | 'coast' | 'boulders' | 'glade' | 'spire';

export interface JourneyChapter {
  id: JourneyChapterId;
  title: string;
  /** What this chapter asks of you. */
  task: string;
  /** What you need to get there. */
  needs: string;
  /** What finishing it opens. */
  opens: string;
  /** `LANDMARKS` id the map walks to. */
  landmark: string;
  place: Tile;
  /** A keepsake that proves you finished it once (kept through defeats). */
  keepsake?: number;
}

export const JOURNEY: readonly JourneyChapter[] = [
  { id: 'grove', title: 'The Grove', task: 'Pick berries until you find a sturdy stick', needs: 'Nothing', opens: 'The bramble hedge', landmark: 'camp', place: { x: 22, z: 18 }, keepsake: Cosmetic.CoastScarf },
  { id: 'coast', title: 'The Coast', task: 'Make a stone club: 1 driftwood + 2 flint', needs: 'A stick', opens: 'The boulder line', landmark: 'harbour', place: { x: 46, z: 29 } },
  { id: 'boulders', title: 'The Boulders', task: 'Gather 3 obsidian at the outcrops, or help topple the Giant', needs: 'A stone club', opens: 'Half a Spire Key', landmark: 'giant', place: { x: 54, z: 54 }, keepsake: Cosmetic.GiantsTooth },
  { id: 'glade', title: "Clatterhorn's Glade", task: 'Defeat Clatterhorn for gleamshell', needs: 'A weapon, and friends help', opens: 'The other half of a Spire Key', landmark: 'glade', place: { ...CLATTER_HOME }, keepsake: Cosmetic.ClatterhornHorn },
  { id: 'spire', title: 'The Sunken Spire', task: 'Make a Spire Key (3 obsidian + 1 gleamshell) and defeat the Shardmother', needs: 'A Spire Key for each member', opens: 'Prism shards and the Shard Circlet', landmark: 'spire', place: { ...SPIRE_GATE }, keepsake: Cosmetic.PrismCrown },
];

const CHAPTER_OF: Record<GoalStepId, JourneyChapterId> = {
  'pick-berry': 'grove', 'eat-berry': 'grove', 'find-stick': 'grove', 'wield-stick': 'grove', 'reach-coast': 'grove',
  'gather-coast': 'coast', 'make-club': 'coast', 'wield-club': 'coast',
  'reach-boulders': 'boulders', 'face-giant': 'boulders', 'gather-obsidian': 'boulders',
  'clatter-sealed': 'glade', 'reach-glade': 'glade', 'clatter-resting': 'glade', 'face-clatterhorn': 'glade',
  'make-key': 'spire', 'spire-sealed': 'spire', 'reach-spire': 'spire', 'open-spire': 'spire', 'make-circlet': 'spire',
  // Recovering a bag is a detour, not a chapter.
  'recover-bag': 'grove',
};

/** The chapter a goal step belongs to; null for detours and no goal. */
export function journeyChapterOf(goalId: GoalStepId | null | undefined): JourneyChapterId | null {
  if (!goalId || goalId === 'recover-bag') return null;
  return CHAPTER_OF[goalId] ?? null;
}

export type JourneyStatus = 'done' | 'current' | 'ahead';

export interface JourneyStep extends JourneyChapter {
  status: JourneyStatus;
  /** A boss chapter whose boss the owner has not opened yet. */
  sealed: boolean;
  /** You have finished this chapter at least once (its keepsake). */
  earned: boolean;
}

/**
 * Every chapter with its status. `current` is the chip goal's chapter; with
 * none (a detour, a defeat, no goal), `fallback` (the last known chapter) or
 * the furthest earned keepsake decides it.
 */
export function journeySteps(input: { goalId?: GoalStepId | null; fallback?: JourneyChapterId | null; cosmetics?: number; bosses?: GoalBosses | null }): JourneyStep[] {
  const mask = input.cosmetics ?? 0;
  const earned = JOURNEY.map((c) => c.keepsake !== undefined && hasCosmetic(mask, c.keepsake));
  let current = JOURNEY.findIndex((c) => c.id === (journeyChapterOf(input.goalId) ?? input.fallback));
  if (current === -1) current = Math.min(JOURNEY.length - 1, earned.lastIndexOf(true) + 1);
  return JOURNEY.map((c, i) => ({
    ...c,
    status: i < current ? 'done' : i === current ? 'current' : 'ahead',
    sealed: (c.id === 'glade' && !input.bosses?.clatterhornOpen) || (c.id === 'spire' && !input.bosses?.spireOpen),
    earned: earned[i],
  }));
}
