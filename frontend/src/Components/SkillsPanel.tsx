import React, { memo } from "react";
import { COSMETICS, RECIPES, SKILLS, Skill, levelProgress, harvestTickBonus, SKILL_MAX_LEVEL, hasCosmetic } from "@sim";
import { useMyCosmetics, useMySkills } from "../spacetime/hooks";
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
  const bonus = harvestTickBonus(level);
  const faster = bonus ? `Harvests ${bonus} tick${bonus > 1 ? "s" : ""} faster (not the gold tree). ` : "";
  return `${faster}${bonus < 2 ? `Faster harvests at level ${bonus === 0 ? 10 : 20}.` : ""}`.trim();
}

/** F2 skills: levels, progress bars and what the next level brings. */
const SkillsPanel = memo(({ open, onClose, onStyle }: Props) => {
  const skills = useMySkills();
  const cosmetics = useMyCosmetics();
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
        Skills stay with you. They unlock recipes, keepsakes ({earned}/{COSMETICS.length} earned) and slightly faster
        harvests — never damage, health or new areas.
      </p>
    </section>
  );
});

export default SkillsPanel;
