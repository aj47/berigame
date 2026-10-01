import React, { memo } from "react";
import { COSMETICS, RECIPES, SKILLS, Skill, levelProgress, harvestTickBonus, SKILL_MAX_LEVEL, hasCosmetic } from "@sim";
import { ADVENTURE_CAMP, PATHS, PATH_FIELDS, TECHNIQUES, techniqueUnlocked, hasTechnique, loadoutCount, chebyshev } from "@sim";
import { useGameActions } from "../spacetime/actions";
import { useAdventureProfiles, useMyPlayer, useMyCosmetics, useMySkills } from "../spacetime/hooks";
import { useProgressStore } from "../spacetime/stores/progressStore";

interface Props {
  open: boolean;
  onClose: () => void;
  /** Switch to the Style panel (the two share a tab bar). */
  onStyle: () => void;
}

const FIELDS = ["foragingXp", "beachcombingXp", "craftingXp"] as const;
const ICONS = ["/items/strawberry.png", "/items/driftwood.png", "/items/stone_club.png"];

/** One line of what a skill's levels bring. */
function perks(skill: Skill, level: number): string {
  if (skill === Skill.Crafting) {
    const next = RECIPES.find((r) => r.level > level);
    return next ? `Next recipe: ${next.name} at level ${next.level}` : "Every recipe unlocked";
  }
  if (skill === Skill.Foraging && level < 2) return "Level 2: guaranteed first stick, then 25% chance of spare sticks.";
  const bonus = harvestTickBonus(level);
  const faster = bonus ? `Harvests ${bonus} tick${bonus > 1 ? "s" : ""} faster (not the gold tree). ` : "";
  return `${faster}${bonus < 2 ? `Faster harvests at level ${bonus === 0 ? 10 : 20}.` : ""}`.trim();
}

/** F2 skills: levels, progress bars and what the next level brings. */
const SkillsPanel = memo(({ open, onClose, onStyle }: Props) => {
  const skills = useMySkills();
  const cosmetics = useMyCosmetics();
  const me = useMyPlayer(), profiles = useAdventureProfiles(), actions = useGameActions();
  const legacy = skills;
  const profile = profiles.find(p => p.identity.toHexString() === me?.identity.toHexString()) ?? { growingXp: legacy?.foragingXp ?? 0, buildingXp: legacy?.craftingXp ?? 0, exploringXp: legacy?.beachcombingXp ?? 0, fightingXp: 0, befriendingXp: 0, feats: (legacy?.foragingXp ? 1 : 0) | (legacy?.craftingXp ? 2 : 0) | (legacy?.beachcombingXp ? 4 : 0), loadout: 0 };
  const atCamp = me && chebyshev(me, ADVENTURE_CAMP) <= 4;
  const banner = useProgressStore((s) => s.banner);
  if (!open) return null;
  const earned = COSMETICS.filter((c) => hasCosmetic(cosmetics?.unlocked ?? 0, c.id)).length;
  return (
    <section className="game-panel skills-panel" aria-label="Skills">
      <header className="panel-heading">
        <div>
          <span className="eyebrow">Your island know-how</span>
          <h2>Skills</h2>
        </div>
        <button className="close-button" onClick={onClose} aria-label="Close skills">×</button>
      </header>
      <div className="panel-tabs" role="tablist">
        <button role="tab" aria-selected="true">Skills</button>
        <button role="tab" aria-selected="false" onClick={onStyle}>Style</button>
      </div>
      <div className="skills-scroll">
      <p><strong>{loadoutCount(profile.loadout)}/3 techniques equipped</strong> · Change freely at camp.</p>
      {!atCamp && <button onClick={() => actions.setTarget(ADVENTURE_CAMP.x, ADVENTURE_CAMP.z)}>Walk to camp to change techniques</button>}
      {PATHS.map((path, i) => { const p = levelProgress(profile[PATH_FIELDS[i]]); return <div key={path}>
        <h3 className="path-heading">{path} · level {p.level}</h3><p className="fine-print">{p.toNext} XP to next level</p>
        <div className="technique-grid">{TECHNIQUES.filter(t => t.path === i).map(t => {
          const unlocked = techniqueUnlocked(profile, t.id), equipped = hasTechnique(profile, t.id);
          const feat = ({1:'Harvest a berry or grow an expedition seed',2:'Craft, split cargo, or help build camp',4:'Explore the Coast or carry a giant berry',8:'Reset the training dummy or complete a friendly duel',16:'Help Moss, bribe Pip, or give a gift',32:'Complete a market delivery',64:'Feed the Giant'} as Record<number,string>)[t.feat];
          return <button key={t.id} className="technique" aria-pressed={equipped} disabled={!unlocked || !atCamp || (!equipped && loadoutCount(profile.loadout) >= 3)} onClick={() => actions.equipTechnique(t.id)}><strong>{t.name}{equipped ? ' · equipped' : ''}</strong><span>{t.description}</span><small>{unlocked ? equipped ? 'Tap to unequip' : 'Tap to equip' : `Level ${t.level} + ${feat}`}</small></button>;
        })}</div>
      </div>; })}
      <h3 className="path-heading">Gathering & recipes</h3>
      <ul className="skill-list">
        {SKILLS.map((def) => {
          const xp = skills?.[FIELDS[def.id]] ?? 0;
          const p = levelProgress(xp);
          const pct = p.max ? 100 : Math.floor((p.into / p.span) * 100);
          return (
            <li key={def.key} className={`skill-row ${banner?.title.startsWith(def.name) ? "just-leveled" : ""}`} data-skill={def.key}>
              <img src={ICONS[def.id]} alt="" />
              <div className="skill-body">
                <div className="skill-title">
                  <strong>{def.name}</strong>
                  <span className="skill-level">Lv {p.level}<small>/{SKILL_MAX_LEVEL}</small></span>
                </div>
                <div className="skill-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={`${def.name} progress to the next level`}>
                  <span style={{ width: `${pct}%` }} />
                </div>
                <span className="fine-print">
                  {p.max ? `${xp} XP · max level` : `${xp} XP · ${p.toNext} to level ${p.level + 1}`} · {def.verb}
                </span>
                <span className="fine-print skill-perk">{perks(def.id, p.level)}</span>
              </div>
            </li>
          );
        })}
      </ul>
      <p className="fine-print">
        Skills stay with you. They unlock techniques, recipes, keepsakes ({earned}/{COSMETICS.length} earned) and slightly faster
        harvests. Techniques never increase PvP damage or health.
      </p>
      </div>
    </section>
  );
});

export default SkillsPanel;
