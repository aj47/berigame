import { useEffect, useRef, useState } from 'react';
import {
  SPIRE_BOSS_NAME, SPIRE_ENRAGE_TICKS, SPIRE_MEALS, SPIRE_NONE, SPIRE_PATTERNS, SPIRE_PHASE_NAMES, SpireMemberState, SpireStage,
  TICK_MS, inSpireCourt, spireImmune, spireSlot,
} from '@sim';
import { useMyPlayer, usePlayersByHex, useTick } from '../../spacetime/hooks';
import { useGameActions } from '../../spacetime/actions';
import { useSettingsStore } from '../../spacetime/stores/settingsStore';
import { useBossStore, type SpireMemberRow } from '../bossStore';
import { bulletStats } from '../bulletStats';
import { inSpire } from '../selectors';
import { starView } from './starModel';
import '../bosses.css';

/**
 * The in-run HUD (FINAL_SPEC 7.6, `data-testid="spire-hud"` with
 * `data-bullets`): boss bar, phase pips, timer, banners, party, stars this
 * wave, meals, court, Leave; outside the floor, the party chip.
 */
export type SpireHudProps = Record<string, never>;

/** "Bloom", "Gale", ... */
export const phaseName = (phase: number) => {
  const n = SPIRE_PHASE_NAMES[Math.min(4, Math.max(1, phase))] ?? '';
  return n.charAt(0).toUpperCase() + n.slice(1);
};
export const PHASE_HINTS = ['', 'Spokes and aimed fans: step between the rays', 'Walls cross; find the gap', 'Curtains close in; ride the drifting corridor', 'Everything at once; keep moving'] as const;

/** Seconds as m:ss. */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
const ticksToSeconds = (ticks: number) => (ticks * TICK_MS) / 1000;
const fmt = (n: number) => n.toLocaleString('en-US');

/** The members of a run, by slot. */
export function runMembers(members: ReadonlyMap<string, SpireMemberRow>, runId: bigint | undefined): [string, SpireMemberRow][] {
  if (runId === undefined) return [];
  return [...members].filter(([, m]) => m.runId === runId).sort((a, b) => a[1].slot - b[1].slot);
}

const STATE_ICON: Record<number, { icon: string; label: string }> = {
  [SpireMemberState.Lobby]: { icon: '…', label: 'waiting' },
  [SpireMemberState.In]: { icon: '●', label: 'fighting' },
  [SpireMemberState.Downed]: { icon: '▼', label: 'down' },
  [SpireMemberState.Out]: { icon: '✕', label: 'knocked out' },
  [SpireMemberState.Left]: { icon: '↩', label: 'left' },
  [SpireMemberState.Done]: { icon: '✓', label: 'done' },
};

interface Banner { id: number; text: string; hint?: string; enrage?: boolean }

export default function SpireHud(_props: SpireHudProps) {
  const me = useMyPlayer();
  const run = useBossStore((s) => s.myRun);
  const fight = useBossStore((s) => s.fight);
  if (!run || run.stage !== SpireStage.Active) return null;
  if (!inSpire(me)) return <PartyChip />;
  return <InsideHud key={String(run.id)} hasFight={!!fight} />;
}

/** Outside the floor while your run fights on (knocked out, or waiting at the exit). */
function PartyChip() {
  const run = useBossStore((s) => s.myRun);
  const fight = useBossStore((s) => s.fight);
  const members = useBossStore((s) => s.members);
  if (!run) return null;
  const fighting = runMembers(members, run.id).filter(([, m]) => m.state === SpireMemberState.In).length;
  const pct = fight && fight.maxHp > 0 ? Math.round((fight.hp / fight.maxHp) * 100) : 100;
  return <div className="spire-chip" data-testid="spire-party-chip">
    Your party: {phaseName(fight?.phase || run.phase || 1)} · {pct}% · {fighting} fighting
  </div>;
}

function InsideHud(_: { hasFight: boolean }) {
  const me = useMyPlayer();
  const tick = useTick();
  const players = usePlayersByHex();
  const { spireLeave } = useGameActions();
  const reduced = useSettingsStore((s) => s.reduceMotion);
  const run = useBossStore((s) => s.myRun)!;
  const fight = useBossStore((s) => s.fight);
  const myMember = useBossStore((s) => s.myMember);
  const meHex = useBossStore((s) => s.meHex);
  const members = useBossStore((s) => s.members);
  const hud = useRef<HTMLDivElement>(null);

  // The live check reads data-bullets; copied once per tick through the ref, never through React state.
  useEffect(() => { hud.current?.setAttribute('data-bullets', String(bulletStats.live)); }, [tick]);

  // Banners: the pattern's name for 1.2 s when it changes; a phase change names the phase with a hint.
  const [banner, setBanner] = useState<Banner | null>(null);
  const bannerTimer = useRef<ReturnType<typeof setTimeout>>();
  const seen = useRef({ kind: fight?.curKind ?? SPIRE_NONE, start: fight?.curStart ?? 0, phase: fight?.phase ?? 0, enraged: false, id: 0 });
  useEffect(() => {
    if (!fight) return;
    const s = seen.current;
    let next: Banner | null = null, ms = 1200;
    const enraged = run.startTick > 0 && tick - run.startTick >= SPIRE_ENRAGE_TICKS;
    if (enraged && !s.enraged) { next = { id: ++s.id, text: `${SPIRE_BOSS_NAME} enrages!`, hint: 'Bullets hit 1 harder', enrage: true }; ms = 2500; }
    else if (fight.phase !== s.phase && fight.phase > 0 && s.phase > 0) { next = { id: ++s.id, text: phaseName(fight.phase), hint: PHASE_HINTS[fight.phase] }; ms = 2500; }
    else if ((fight.curKind !== s.kind || fight.curStart !== s.start) && fight.curKind !== SPIRE_NONE && SPIRE_PATTERNS[fight.curKind]) {
      next = { id: ++s.id, text: SPIRE_PATTERNS[fight.curKind].name };
    }
    s.kind = fight.curKind; s.start = fight.curStart; s.phase = fight.phase; s.enraged = enraged;
    if (!next) return;
    setBanner(next);
    const id = next.id;
    // Not an effect cleanup: this effect re-runs every tick, which must not cancel the banner's timer.
    clearTimeout(bannerTimer.current);
    bannerTimer.current = setTimeout(() => setBanner((b) => (b?.id === id ? null : b)), ms);
  }, [fight, run.startTick, tick]);
  useEffect(() => () => clearTimeout(bannerTimer.current), []);

  const [confirmLeave, setConfirmLeave] = useState(false);
  useEffect(() => {
    if (!confirmLeave) return;
    const t = setTimeout(() => setConfirmLeave(false), 3000);
    return () => clearTimeout(t);
  }, [confirmLeave]);

  const hp = fight?.hp ?? 0, maxHp = fight?.maxHp ?? 0, phase = fight?.phase || run.phase || 1;
  const pct = maxHp > 0 ? Math.max(0, Math.min(100, (hp / maxHp) * 100)) : 0;
  const left = ticksToSeconds(run.endTick - tick);
  const enrageIn = run.startTick > 0 ? ticksToSeconds(run.startTick + SPIRE_ENRAGE_TICKS - tick) : null;
  const intro = run.startTick > 0 && tick < run.startTick ? ticksToSeconds(run.startTick - tick) : null;
  const party = runMembers(members, run.id);
  const slot = myMember?.slot ?? 0;
  const stars = starView(run, fight, tick);
  const meals = Math.max(0, SPIRE_MEALS - (myMember?.meals ?? 0));
  const immune = !!fight && spireImmune(spireSlot(fight, 'hitTick', slot), tick);

  return <div ref={hud} className={`spire-hud${reduced ? ' spire-reduced' : ''}`} data-testid="spire-hud" data-bullets={String(bulletStats.live)}>
    <div className="spire-top">
      <div className="spire-boss-label">
        <span>{SPIRE_BOSS_NAME} · {fmt(hp)}/{fmt(maxHp)}</span>
        <span className="spire-pips" aria-label={`Phase ${phase} of 4: ${phaseName(phase)}`}>
          {[1, 2, 3, 4].map((p) => <span key={p} className={`spire-pip${p <= phase ? ' is-on' : ''}`} />)}
        </span>
        <span className={`spire-timer${left < 90 ? ' is-low' : ''}`} data-testid="spire-timer">{clock(left)}</span>
      </div>
      <div className="spire-boss-bar" role="meter" aria-label={SPIRE_BOSS_NAME} aria-valuemin={0} aria-valuemax={maxHp} aria-valuenow={hp}
        data-testid="spire-boss-bar" data-phase={phase}>
        <div className="spire-boss-fill" style={{ width: `${pct}%` }} />
        {[70, 40, 15].map((n) => <span key={n} className="spire-notch" style={{ left: `${n}%` }} />)}
      </div>
      {intro !== null
        ? <div className="spire-enrage">Get ready: {Math.ceil(intro)} s</div>
        : enrageIn !== null && <div className="spire-enrage">{enrageIn > 0 ? `Enrage in ${clock(enrageIn)}` : 'Enraged: bullets hit harder'}</div>}
      {banner && <div className={`spire-banner${banner.enrage ? ' is-enrage' : ''}`} data-testid="spire-banner" key={banner.id}>
        {banner.text}{banner.hint && <small>{banner.hint}</small>}
      </div>}
    </div>
    <ul className="spire-party" data-testid="spire-party" aria-label="Your party">
      {party.map(([hex, m]) => {
        const p = players.get(hex);
        const away = m.state === SpireMemberState.In && m.awaySinceTick > 0;
        const st = away ? { icon: '◌', label: 'away' } : STATE_ICON[m.state] ?? STATE_ICON[SpireMemberState.In];
        return <li key={hex} data-me={hex === meHex} title={st.label}>
          <span aria-label={st.label}>{st.icon}</span>
          <span>{p?.name || 'Someone'}</span>
          <span>
            {m.state === SpireMemberState.In && p ? <span className="spire-member-hp">{p.hp} HP </span> : null}
            <span className="spire-member-stars">★{fight ? spireSlot(fight, 'stars', m.slot) : 0}</span>
          </span>
        </li>;
      })}
    </ul>
    <div className="spire-bottom">
      <span data-testid="spire-stars">Stars this wave {stars.caught}/{stars.count || Math.max(1, run.partySize) + 2}</span>
      <span className="spire-meals" aria-label={`${meals} of ${SPIRE_MEALS} meals left`}>{'●'.repeat(meals)}{'○'.repeat(SPIRE_MEALS - meals)} <small>F eat</small></span>
      {me && inSpireCourt(me) && <span className="spire-court">In the court: striking</span>}
      {immune && <span className="spire-shield">Shielded</span>}
      <button type="button" className="spire-leave" onClick={() => { if (confirmLeave) { setConfirmLeave(false); void spireLeave(); } else setConfirmLeave(true); }}>
        {confirmLeave ? 'Forfeit? Tap again' : 'Leave (forfeit)'}
      </button>
    </div>
  </div>;
}
