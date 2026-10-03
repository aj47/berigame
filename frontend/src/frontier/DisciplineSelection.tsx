import React, { useEffect, useState } from 'react';
import { levelForXp } from '@sim';
import { DISCIPLINE_PERKS, DISCIPLINES, FRONTIER } from '../../../shared/sim/frontier/catalog';
import type { Profile } from '../../../shared/sim/frontier/model';
import type { Command } from '../../../shared/sim/frontier/engine';
import { sameDisciplines, specializationSwitch } from '../../../shared/sim/frontier/specialization';
import { wikiUrl } from '../site/siteUrls';

function waitLabel(ms: number) {
  const minutes = Math.ceil(ms / 60_000), hours = Math.floor(minutes / 60);
  return hours ? `${hours}h${minutes % 60 ? ` ${minutes % 60}m` : ''}` : `${minutes}m`;
}

export default function DisciplineSelection({ profile, now, busy, blockedReason = '', onActivate }: {
  profile: Profile;
  now: number;
  busy: boolean;
  blockedReason?: string;
  onActivate: (command: Command) => unknown;
}) {
  const [choice, setChoice] = useState<number[]>(() => profile.active.slice());
  const activeKey = profile.active.join(',');
  useEffect(() => setChoice(profile.active.slice()), [profile.id, activeKey]);
  const switching = specializationSwitch(profile, now);
  const unchanged = sameDisciplines(profile.active, choice);
  const disabled = busy || !!blockedReason || choice.length !== 2 || unchanged;
  return <>
    <p>Choose two active disciplines to use their perks. All five keep earning XP.</p>
    <details><summary>How disciplines relate to skills</summary>
      <p>Skills &amp; techniques tracks island gathering and camp abilities. Disciplines track Meadows activities and can improve combat, crafting and companions.</p>
      <p>Your existing skill and adventure XP gives disciplines a starting boost the first time you use a Meadows activity. After that, their XP grows separately.</p>
      <a href={wikiUrl('frontier-disciplines')} target="_blank" rel="noreferrer">Discipline guide ↗</a>
    </details>
    {DISCIPLINES.map((name, i) => <article key={name}>
      <div className="frontier-row">
        <div><h3>{name}</h3><div className="frontier-stats">
          <span>Lv. {levelForXp(profile.xp[i])}</span><span>{profile.xp[i]} XP</span>
          {profile.active.includes(i) && <span className="frontier-active">Active</span>}
        </div></div>
        <button aria-label={`Select ${name}`} aria-pressed={choice.includes(i)}
          disabled={busy || (!choice.includes(i) && choice.length === 2)}
          onClick={() => setChoice(choice.includes(i) ? choice.filter(n => n !== i) : [...choice, i])}>
          {choice.includes(i) ? 'Selected' : 'Select'}
        </button>
      </div>
      <details><summary>Abilities</summary><ul>{DISCIPLINE_PERKS[i].map(perk => <li key={perk}>{perk}</li>)}</ul></details>
    </article>)}
    <p>{choice.length}/2 selected · Change in Meadows town outside conflict and voyages.</p>
    {unchanged && choice.length === 2 && <p className="frontier-hint">This pair is already active.</p>}
    {blockedReason && <p className="frontier-hint">{blockedReason}</p>}
    <button disabled={disabled || !!switching.waitMs || profile.coins < switching.normalCost}
      onClick={() => onActivate({ action: 'specialize', disciplines: choice })}>
      {switching.first ? 'Activate pair · free' : `Activate pair · ${switching.normalCost} coins`}
    </button>
    {switching.waitMs > 0 ? <>
      <p className="frontier-hint">The {switching.normalCost}-coin switch is available in {waitLabel(switching.waitMs)}. Switch early for {switching.earlyCost} coins total ({switching.normalCost} + {FRONTIER.earlySwitchExtraCost} extra).</p>
      <button disabled={disabled || profile.coins < switching.earlyCost}
        onClick={() => onActivate({ action: 'specialize', disciplines: choice, earlySwitch: true })}>
        Switch now · {switching.earlyCost} coins total
      </button>
      {profile.coins < switching.earlyCost && <p className="frontier-hint">You have {profile.coins} coins. Earn {switching.earlyCost - profile.coins} more to switch early.</p>}
    </> : !switching.first && profile.coins < switching.normalCost && <p className="frontier-hint">You have {profile.coins} coins. Earn {switching.normalCost - profile.coins} more to change disciplines.</p>}
    <p className="frontier-hint">Your first pair is free. Each change starts a new 24-hour wait; your earned XP stays.</p>
  </>;
}
