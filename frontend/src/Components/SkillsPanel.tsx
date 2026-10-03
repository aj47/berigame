import React, { memo, useState } from "react";
import { COSMETICS, RECIPES, SKILLS, Skill, levelProgress, harvestTickBonus, SKILL_MAX_LEVEL, hasCosmetic } from "@sim";
import { ADVENTURE_CAMP, PATHS, PATH_FIELDS, TECHNIQUES, techniqueUnlocked, hasTechnique, loadoutCount, chebyshev } from "@sim";
import { useGameActions } from "../spacetime/actions";
import { useAdventureProfiles, useMyPlayer, useMyCosmetics, useMySkills } from "../spacetime/hooks";
import { useProgressStore } from "../spacetime/stores/progressStore";
import { wikiUrl } from "../site/siteUrls";

interface Props {
  open: boolean;
  onClose: () => void;
  /** Switch to the Style panel (the two share a tab bar). */
  onStyle: () => void;
}

const FIELDS = ["foragingXp", "beachcombingXp", "craftingXp"] as const;
const ICONS = ["/items/strawberry.png", "/items/driftwood.png", "/items/stone_club.png"];
const PATH_ICONS = ["🌱", "🪵", "🧭", "🛡️", "💛"];
const FEATS: Record<number, string> = {
  1: "Harvest a berry or grow an expedition seed",
  2: "Craft, split cargo, or help build camp",
  4: "Explore the Coast or carry a giant berry",
  8: "Reset the training dummy or complete a friendly duel",
  16: "Help Moss, bribe Pip, or give a gift",
  32: "Complete a berry delivery",
  64: "Feed the Giant",
};

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
  const [selectedPath, setSelectedPath] = useState(0);
  const skills = useMySkills();
  const cosmetics = useMyCosmetics();
  const me = useMyPlayer(), profiles = useAdventureProfiles(), actions = useGameActions();
  const legacy = skills;
  const profile = profiles.find(p => p.identity.toHexString() === me?.identity.toHexString()) ?? { growingXp: legacy?.foragingXp ?? 0, buildingXp: legacy?.craftingXp ?? 0, exploringXp: legacy?.beachcombingXp ?? 0, fightingXp: 0, befriendingXp: 0, feats: (legacy?.foragingXp ? 1 : 0) | (legacy?.craftingXp ? 2 : 0) | (legacy?.beachcombingXp ? 4 : 0), loadout: 0 };
  const atCamp = me && chebyshev(me, ADVENTURE_CAMP) <= 4;
  const banner = useProgressStore((s) => s.banner);
  if (!open) return null;
  const earned = COSMETICS.filter((c) => hasCosmetic(cosmetics?.unlocked ?? 0, c.id)).length;
  const equippedCount = loadoutCount(profile.loadout);
  const pathProgress = levelProgress(profile[PATH_FIELDS[selectedPath]]);
  return (
    <section className="game-panel skills-panel" aria-label="Skills">
      <header className="panel-heading">
        <div>
          <h2>Skills &amp; techniques</h2>
        </div>
        <button className="close-button" onClick={onClose} aria-label="Close skills">×</button>
      </header>
      <div className="panel-tabs" role="tablist" aria-label="Character panels">
        <button role="tab" aria-selected="true">Skills</button>
        <button role="tab" aria-selected="false" onClick={onStyle}>Style</button>
      </div>
      <div className="skills-scroll">
      <div className="skills-loadout">
        <div><strong>Techniques</strong><span>{equippedCount}/3 equipped</span></div>
        {!atCamp && <button onClick={() => actions.setTarget(ADVENTURE_CAMP.x, ADVENTURE_CAMP.z)}>Walk to camp</button>}
      </div>
      <p className="skills-loadout-hint" id="skills-loadout-status">
        {equippedCount >= 3 ? "Unequip one to make room." : "Choose up to 3. Change them at camp."}
      </p>
      <div className="skills-paths" role="group" aria-label="Adventure paths">
        {PATHS.map((path, i) => {
          const p = levelProgress(profile[PATH_FIELDS[i]]);
          const pct = p.max ? 100 : Math.floor((p.into / p.span) * 100);
          return <button key={path} className="skills-path" aria-pressed={selectedPath === i}
            aria-label={`${path}, level ${p.level}, ${p.max ? "max level" : `${p.toNext} XP to level ${p.level + 1}`}`}
            onClick={() => setSelectedPath(i)}>
            <span className="skills-path-icon" aria-hidden="true">{PATH_ICONS[i]}</span>
            <strong>{path}</strong><span className="skills-path-level">Lv {p.level}</span>
            <span className="skills-path-bar" aria-hidden="true"><span style={{ width: `${pct}%` }} /></span>
          </button>;
        })}
      </div>
      <section className="skills-path-detail" aria-label={`${PATHS[selectedPath]} techniques`}>
        <div className="skills-section-heading">
          <h3>{PATHS[selectedPath]}</h3>
          <span>{pathProgress.max ? "Max level" : `${pathProgress.toNext} XP to level ${pathProgress.level + 1}`}</span>
        </div>
        <div className="skills-techniques">{TECHNIQUES.filter(t => t.path === selectedPath).map(t => {
          const unlocked = techniqueUnlocked(profile, t.id), equipped = hasTechnique(profile, t.id);
          const levelMet = pathProgress.level >= t.level, featMet = (profile.feats & t.feat) !== 0;
          return <details key={t.id} className={`skills-technique${equipped ? " is-equipped" : ""}`}>
            <summary><strong>{t.name}</strong><span className="skills-technique-state">{equipped ? "✓ Equipped" : unlocked ? "Unlocked" : "Locked"}</span></summary>
            <div className="skills-technique-detail">
              <p>{t.description}</p>
              {!unlocked && <ul className="skills-requirements" aria-label={`${t.name} requirements`}>
                <li data-met={levelMet}><span aria-hidden="true">{levelMet ? "✓" : "○"}</span>{PATHS[t.path]} level {t.level}<span className="sr-only">{levelMet ? ", complete" : ", needed"}</span></li>
                <li data-met={featMet}><span aria-hidden="true">{featMet ? "✓" : "○"}</span>{FEATS[t.feat]}<span className="sr-only">{featMet ? ", complete" : ", needed"}</span></li>
              </ul>}
              {unlocked && <button aria-label={`${equipped ? "Unequip" : "Equip"} ${t.name}`} aria-pressed={equipped}
                aria-describedby="skills-loadout-status" disabled={!atCamp || (!equipped && equippedCount >= 3)}
                onClick={() => actions.equipTechnique(t.id)}>{equipped ? "Unequip" : "Equip"}</button>}
            </div>
          </details>;
        })}</div>
      </section>
      <details className="skills-gathering">
      <summary>Gathering & recipes</summary>
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
                  {p.max ? "Max level" : `${p.toNext} XP to level ${p.level + 1}`}
                </span>
                <details className="skill-perks"><summary>Unlocks & tips</summary>
                  <p>{def.verb}.</p><p className="skill-perk">{perks(def.id, p.level)}</p>
                </details>
              </div>
            </li>
          );
        })}
      </ul>
      </details>
      <details className="skills-about"><summary>About skills · {earned}/{COSMETICS.length} keepsakes</summary>
        <p>Progress is permanent. Unlock recipes, keepsakes and faster harvests as you play.</p>
        <p>Techniques never increase PvP damage or health.</p>
        <p>Meadows disciplines have separate XP and two active perk choices. Your existing progress gives them a one-time starting boost. <a href={wikiUrl('frontier-disciplines')} target="_blank" rel="noreferrer">About disciplines ↗</a></p>
      </details>
      </div>
    </section>
  );
});

export default SkillsPanel;
