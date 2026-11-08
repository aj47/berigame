import { useEffect, useRef, useState } from 'react';
import {
  BossId, BossNoticeKind, HurtSource, LANTERN_BOSS_NAME, LANTERN_ENRAGE_TICKS, LANTERN_MEALS, LanternStage, SpireMemberState, SpireStage,
  TICK_MS, lanternSecondsLeft, lanternSlot,
} from '@sim';
import { useInventoryRows, useMyPlayer, usePlayersByHex, useTick } from '../../spacetime/hooks';
import { useGameActions } from '../../spacetime/actions';
import { useSettingsStore } from '../../spacetime/stores/settingsStore';
import { useBossStore } from '../bossStore';
import { inLantern } from '../selectors';
import { clock } from '../spire/SpireHud';
import { bestFoodSlot } from '../spire/SpireControls';
import { lanternRunMembers } from './LanternLobbyPanel';
import { lanternMeInReach, lanternStatus } from './lanternModel';
import '../bosses.css';

/**
 * Lanternmaw's in-run HUD (`data-testid="lantern-hud"`): boss bar and phase
 * pips, the stage (Den, Dive, Tide, Ebb) and the den pattern's name, the 6:00
 * timer, the spring and its countdown, choked, party HP and damage, meals,
 * the last hurt by source, Eat and Leave; outside the floor, the party chip.
 */
export type LanternHudProps = Record<string, never>;

const SPRING_NAMES = ['north-west', 'north-east', 'south-east', 'south-west'] as const;
const fmt = (n: number) => n.toLocaleString('en-US');

/** The hurt line for a Hurt notice's source. */
export function lanternHurtText(source: number, amount: number): string {
  switch (source) {
    case HurtSource.Blow: return `Den blow -${amount}`;
    case HurtSource.Pulse: return `Lure pulse -${amount}`;
    case HurtSource.Drown: return `Drowning in the flood -${amount}`;
    case HurtSource.Bite: return `Bitten capping the spring -${amount}`;
    default: return `Hurt -${amount}`;
  }
}

const STATE_ICON: Record<number, { icon: string; label: string }> = {
  [SpireMemberState.Lobby]: { icon: '…', label: 'waiting' },
  [SpireMemberState.In]: { icon: '●', label: 'fighting' },
  [SpireMemberState.Out]: { icon: '✕', label: 'knocked out' },
  [SpireMemberState.Left]: { icon: '↩', label: 'left' },
  [SpireMemberState.Done]: { icon: '✓', label: 'done' },
};

export default function LanternHud(_props: LanternHudProps) {
  const me = useMyPlayer();
  const run = useBossStore((s) => s.myLanternRun);
  if (!run || run.stage !== SpireStage.Active) return null;
  if (!inLantern(me)) return <PartyChip />;
  return <InsideHud key={String(run.id)} />;
}

function PartyChip() {
  const run = useBossStore((s) => s.myLanternRun);
  const fight = useBossStore((s) => s.lanternFight);
  const members = useBossStore((s) => s.lanternMembers);
  if (!run) return null;
  const fighting = lanternRunMembers(members, run.id).filter(([, m]) => m.state === SpireMemberState.In).length;
  const pct = fight && fight.maxHp > 0 ? Math.round((fight.hp / fight.maxHp) * 100) : 100;
  return <div className="spire-chip lantern-chip" data-testid="lantern-party-chip">Your party: {LANTERN_BOSS_NAME} {pct}% · {fighting} fighting</div>;
}

function InsideHud() {
  const me = useMyPlayer();
  const tick = useTick();
  const players = usePlayersByHex();
  const inventory = useInventoryRows();
  const { lanternLeave, eatBerry } = useGameActions();
  const reduced = useSettingsStore((s) => s.reduceMotion);
  const run = useBossStore((s) => s.myLanternRun)!;
  const fight = useBossStore((s) => s.lanternFight);
  const myMember = useBossStore((s) => s.myLanternMember);
  const meHex = useBossStore((s) => s.meHex);
  const members = useBossStore((s) => s.lanternMembers);
  const hurt = useBossStore((s) => {
    for (let i = s.notices.length - 1; i >= 0; i--) {
      const n = s.notices[i];
      if (n.row.boss === BossId.Lanternmaw && n.row.kind === BossNoticeKind.Hurt && n.row.runId === run.id) return n;
    }
    return null;
  });

  // The latest hurt line stays up for 2 s.
  const [hurtSeq, setHurtSeq] = useState<number | null>(null);
  const first = useRef(hurt?.seq ?? 0);
  useEffect(() => {
    if (!hurt || hurt.seq <= first.current) return;
    setHurtSeq(hurt.seq);
    const t = setTimeout(() => setHurtSeq((s) => (s === hurt.seq ? null : s)), 2000);
    return () => clearTimeout(t);
  }, [hurt]);

  const [confirmLeave, setConfirmLeave] = useState(false);
  useEffect(() => {
    if (!confirmLeave) return;
    const t = setTimeout(() => setConfirmLeave(false), 3000);
    return () => clearTimeout(t);
  }, [confirmLeave]);

  const hp = fight?.hp ?? 0, maxHp = fight?.maxHp ?? 0, phase = Math.min(3, Math.max(1, fight?.phase || run.phase || 1));
  const pct = maxHp > 0 ? Math.max(0, Math.min(100, (hp / maxHp) * 100)) : 0;
  const left = lanternSecondsLeft(run.startTick, run.endTick, tick);
  const intro = run.startTick > 0 && tick < run.startTick ? ((run.startTick - tick) * TICK_MS) / 1000 : null;
  const enraged = run.startTick > 0 && tick - run.startTick >= LANTERN_ENRAGE_TICKS;
  const status = lanternStatus(fight, tick);
  const party = lanternRunMembers(members, run.id);
  const meals = Math.max(0, LANTERN_MEALS - (myMember?.meals ?? 0));
  const food = bestFoodSlot(inventory);
  const reach = lanternMeInReach(fight, tick, me);
  const spring = status.spring >= 0 ? SPRING_NAMES[status.spring] : null;

  return <div className={`spire-hud lantern-hud${reduced ? ' spire-reduced' : ''}`} data-testid="lantern-hud" data-stage={status.stage.toLowerCase()}>
    <div className="spire-top">
      <div className="spire-boss-label">
        <span>{LANTERN_BOSS_NAME} · {fmt(hp)}/{fmt(maxHp)}</span>
        <span className="spire-pips" aria-label={`Phase ${phase} of 3`}>
          {[1, 2, 3].map((p) => <span key={p} className={`spire-pip${p <= phase ? ' is-on' : ''}`} />)}
        </span>
        <span className={`spire-timer${left < 90 ? ' is-low' : ''}`} data-testid="lantern-timer">{clock(left)}</span>
      </div>
      <div className="spire-boss-bar lantern-boss-bar" role="meter" aria-label={LANTERN_BOSS_NAME} aria-valuemin={0} aria-valuemax={maxHp} aria-valuenow={hp}
        data-testid="lantern-boss-bar" data-phase={phase}>
        <div className="spire-boss-fill" style={{ width: `${pct}%` }} />
        {[66.7, 33.3].map((n) => <span key={n} className="spire-notch" style={{ left: `${n}%` }} />)}
      </div>
      <div className="lantern-stage" data-testid="lantern-stage">
        <b>{status.stage}</b>{status.pattern && <> · <span data-testid="lantern-pattern">{status.pattern}</span></>}
        {spring && status.surfacesIn !== null && <> · surfaces at the {spring} spring in {Math.ceil(status.surfacesIn)} s</>}
        {spring && status.surfacesIn === null && fight?.stage === LanternStage.Tide && <> · at the {spring} spring</>}
      </div>
      {intro !== null
        ? <div className="spire-enrage">Get ready: {Math.ceil(intro)} s</div>
        : enraged && <div className="spire-enrage">Enraged: blows hit harder</div>}
      {status.choked && <div className="spire-banner lantern-choked" data-testid="lantern-choked">Choked! Double damage<small>It cannot heal or pulse</small></div>}
      {status.flooded && !status.choked && <div className="spire-banner lantern-flood" data-testid="lantern-flood">High tide: stay on the planks</div>}
      {hurt && hurtSeq === hurt.seq && <div className="lantern-hurt" data-testid="lantern-hurt" key={hurt.seq}>{lanternHurtText(hurt.row.quantity, hurt.row.amount)}</div>}
    </div>
    <ul className="spire-party" data-testid="lantern-party" aria-label="Your party">
      {party.map(([hex, m]) => {
        const p = players.get(hex);
        const away = m.state === SpireMemberState.In && m.awaySinceTick > 0;
        const st = away ? { icon: '◌', label: 'away' } : STATE_ICON[m.state] ?? STATE_ICON[SpireMemberState.In];
        return <li key={hex} data-me={hex === meHex} title={st.label}>
          <span aria-label={st.label}>{st.icon}</span>
          <span>{p?.name || 'Someone'}</span>
          <span>
            {m.state === SpireMemberState.In && p ? <span className="spire-member-hp">{p.hp} HP </span> : null}
            <span className="spire-member-stars">{fight ? fmt(lanternSlot(fight, 'dmg', m.slot)) : 0} dmg</span>
          </span>
        </li>;
      })}
    </ul>
    <div className="spire-bottom">
      <span className="spire-meals" aria-label={`${meals} of ${LANTERN_MEALS} meals left`}>{'●'.repeat(meals)}{'○'.repeat(LANTERN_MEALS - meals)}</span>
      <button type="button" className="spire-leave lantern-eat" disabled={meals === 0 || food < 0 || myMember?.state !== SpireMemberState.In} onClick={() => { if (food >= 0) void eatBerry(food); }}>Eat</button>
      {reach && <span className="spire-court">In reach: swinging</span>}
      <button type="button" className="spire-leave" onClick={() => { if (confirmLeave) { setConfirmLeave(false); void lanternLeave(); } else setConfirmLeave(true); }}>
        {confirmLeave ? 'Forfeit? Tap again' : 'Leave (forfeit)'}
      </button>
    </div>
  </div>;
}
