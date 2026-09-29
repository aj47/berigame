import { create } from 'zustand';
import { COSMETICS, RECIPES, SKILLS, Skill, getCosmetic, hasCosmetic, levelForXp } from '@sim';

/** DamageNumber kind for an XP floater (no EventKind uses it). */
export const XP_FLOAT_KIND = 100;
const XP_FLOAT_MS = 1600;
const BANNER_MS = 6000;
/** Floaters follow the harvest "+1" rather than covering it. */
const XP_DELAY_MS = 350;

export interface XpFloat { seq: number; text: string; at: number }
export interface Milestone {
  seq: number;
  kind: 'level' | 'cosmetic';
  title: string;
  detail: string;
}

interface SkillXp { foragingXp: number; beachcombingXp: number; craftingXp: number }
const FIELDS = ['foragingXp', 'beachcombingXp', 'craftingXp'] as const;

interface ProgressState {
  seq: number;
  xpFloat: XpFloat | null;
  banner: Milestone | null;
  /** Compare your new player_skill row with the last one: floaters and level-ups. */
  onSkills: (prev: SkillXp | null, next: SkillXp) => void;
  /** Compare your new player_cosmetic unlock mask with the last one. */
  onCosmetics: (prevMask: number, nextMask: number) => void;
}

let floatTimer: ReturnType<typeof setTimeout> | null = null;
let bannerTimer: ReturnType<typeof setTimeout> | null = null;
/** Called on a level-up or unlock (FxLayer plays the fanfare); swapped in tests. */
export const progressHooks = { onMilestone: (_m: Milestone) => {} };

export const useProgressStore = create<ProgressState>((set, get) => {
  const showBanner = (m: Omit<Milestone, 'seq'>) => {
    const seq = get().seq + 1;
    const banner = { ...m, seq };
    set({ seq, banner });
    progressHooks.onMilestone(banner);
    if (bannerTimer) clearTimeout(bannerTimer);
    bannerTimer = setTimeout(() => { if (get().banner?.seq === seq) set({ banner: null }); }, BANNER_MS);
  };
  return {
    seq: 0,
    xpFloat: null,
    banner: null,
    onSkills: (prev, next) => {
      const gains: string[] = [];
      for (let i = 0; i < FIELDS.length; i++) {
        const before = prev?.[FIELDS[i]] ?? 0, after = next[FIELDS[i]];
        if (after <= before) continue;
        gains.push(`+${after - before} ${SKILLS[i].name}`);
        const from = levelForXp(before), to = levelForXp(after);
        if (to > from) {
          const unlocked = COSMETICS.filter((c) => c.skill?.skill === (i as Skill) && from < c.skill.level && to >= c.skill.level).map((c) => c.name);
          showBanner({ kind: 'level', title: `${SKILLS[i].name} level ${to}!`, detail: unlocked.length ? `Unlocked: ${unlocked.join(', ')}` : levelPerk(i as Skill, to) });
        }
      }
      if (!gains.length) return;
      const seq = get().seq + 1;
      set({ seq, xpFloat: { seq, text: gains.join(' · '), at: performance.now() + XP_DELAY_MS } });
      if (floatTimer) clearTimeout(floatTimer);
      floatTimer = setTimeout(() => { if (get().xpFloat?.seq === seq) set({ xpFloat: null }); }, XP_FLOAT_MS + XP_DELAY_MS);
    },
    onCosmetics: (prevMask, nextMask) => {
      for (const c of COSMETICS) {
        if (hasCosmetic(nextMask, c.id) && !hasCosmetic(prevMask, c.id) && !c.skill) {
          showBanner({ kind: 'cosmetic', title: `New keepsake: ${getCosmetic(c.id)!.name}`, detail: 'You are wearing it. Change it in Style.' });
        }
      }
    },
  };
});

/** What a level brings besides cosmetics (harvest speed at 10 and 20, recipes for Crafting). */
function levelPerk(skill: Skill, level: number): string {
  if (skill !== Skill.Crafting && (level === 10 || level === 20)) return `Harvests ${level === 10 ? 'one tick' : 'two ticks'} faster (not the gold tree)`;
  const recipes = skill === Skill.Crafting ? RECIPES.filter((r) => r.level === level).map((r) => r.name) : [];
  return recipes.length ? `New recipe: ${recipes.join(', ')}` : 'Keep going!';
}
