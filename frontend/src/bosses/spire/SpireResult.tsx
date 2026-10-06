import { useEffect, useMemo, useState } from 'react';
import {
  BossId, BossNoticeKind, COSMETICS, SPIRE_BOSS_NAME, SPIRE_REWARD, SpireMemberState, SpireOutcome, SpireStage, TICK_MS,
  getItemDef, spireSlot,
} from '@sim';
import { usePlayersByHex } from '../../spacetime/hooks';
import { useBossStore, type SpireFightRow, type SpireRunRow } from '../bossStore';
import { clock, runMembers } from './SpireHud';
import '../bosses.css';

/**
 * The result card (FINAL_SPEC 7.6, `data-testid="spire-result"`), shown by
 * membership, not position: while your member row is Done or Out and its
 * run is Cleared or Failed, wherever you stand (at a clear the eject and the
 * final fight row arrive together, so you are already at the exit). A Left
 * row shows it only with the run's RunResult notice: the server sends none
 * for a forfeit or for a member away at the end (WP4), so a player who gave
 * the run up is not handed its result card minutes later. It
 * opens with a 1.2 s header, then the outcome, time, per-member stars / hits /
 * damage, rewards and keepsakes from your notices, and "Flawless!".
 * Dismissable; it closes itself when the run row is deleted.
 */
export type SpireResultProps = Record<string, never>;

const ENDED: ReadonlySet<number> = new Set([SpireMemberState.Done, SpireMemberState.Out]);

/** Whether the card shows for this membership (`gotResult`: your RunResult notice for this run arrived). */
export function resultVisible(member: { state: number } | null, run: { stage: number } | null, gotResult = false): boolean {
  if (!member || !run || (run.stage !== SpireStage.Cleared && run.stage !== SpireStage.Failed)) return false;
  return ENDED.has(member.state) || (member.state === SpireMemberState.Left && gotResult);
}

/** The header of an ended run. */
export function resultHeadline(run: Pick<SpireRunRow, 'stage' | 'outcome'>): string {
  if (run.stage === SpireStage.Cleared || run.outcome === SpireOutcome.Cleared) return `${SPIRE_BOSS_NAME} shatters`;
  switch (run.outcome) {
    case SpireOutcome.TimedOut: return 'Time ran out';
    case SpireOutcome.Wiped: return 'The party fell';
    case SpireOutcome.Abandoned: return 'The party scattered';
    case SpireOutcome.Closed: return 'The Sunken Spire was sealed';
    case SpireOutcome.Reset: return 'The Spire was updated';
    default: return 'The run is over';
  }
}

export default function SpireResult(_props: SpireResultProps) {
  const member = useBossStore((s) => s.myMember);
  const run = useBossStore((s) => s.myRun);
  const gotResult = useBossStore((s) => !!s.myRun && s.notices.some((n) => n.row.boss === BossId.Spire && n.row.kind === BossNoticeKind.RunResult && n.row.runId === s.myRun!.id));
  const [dismissed, setDismissed] = useState<string | null>(null);
  if (!run || !resultVisible(member, run, gotResult) || dismissed === String(run.id)) return null;
  return <ResultCard run={run} onClose={() => setDismissed(String(run.id))} />;
}

function ResultCard({ run, onClose }: { run: SpireRunRow; onClose: () => void }) {
  const fight: SpireFightRow | null = useBossStore((s) => s.fight);
  const members = useBossStore((s) => s.members);
  const meHex = useBossStore((s) => s.meHex);
  const notices = useBossStore((s) => s.notices);
  const players = usePlayersByHex();
  const [intro, setIntro] = useState(true);
  useEffect(() => { const t = setTimeout(() => setIntro(false), 1200); return () => clearTimeout(t); }, []);

  const headline = resultHeadline(run);
  const cleared = run.stage === SpireStage.Cleared;
  const time = clock((run.clearTicks * TICK_MS) / 1000);
  // Slots by member; a slot whose member row was deleted (gave up the reward) shows "left".
  const bySlot = useMemo(() => {
    const out: { slot: number; hex: string | null; state: number | null }[] = [];
    const found = new Map(runMembers(members, run.id).map(([hex, m]) => [m.slot, { hex, state: m.state }] as const));
    for (let slot = 0; slot < Math.max(run.partySize, found.size); slot++) {
      const m = found.get(slot);
      out.push({ slot, hex: m?.hex ?? null, state: m?.state ?? null });
    }
    return out;
  }, [members, run.id, run.partySize]);
  const mine = notices.filter((n) => n.row.boss === BossId.Spire && n.row.runId === run.id);
  const rewards = mine.filter((n) => n.row.kind === BossNoticeKind.Reward);
  const keepsakes = mine.filter((n) => n.row.kind === BossNoticeKind.Keepsake);
  const flawless = keepsakes.some((n) => n.row.quantity === SPIRE_REWARD.pendant);

  if (intro) {
    return <section className="spire-result is-intro" data-testid="spire-result" role="dialog" aria-label="Sunken Spire result">
      <h2>{headline}</h2>
    </section>;
  }
  return <section className="spire-result" data-testid="spire-result" role="dialog" aria-label="Sunken Spire result">
    <h2>{headline}</h2>
    <p className="spire-result-sub">{cleared ? `Cleared in ${time}` : 'No reward this time'}</p>
    <table>
      <thead><tr><th>Member</th><th>Stars</th><th>Hits</th><th>Damage</th></tr></thead>
      <tbody>
        {bySlot.map(({ slot, hex, state }) => {
          const name = hex ? (players.get(hex)?.name || 'Someone') : 'left';
          const label = state === SpireMemberState.Left ? `${name} (left)` : state === SpireMemberState.Out ? `${name} (knocked out)` : name;
          return <tr key={slot} data-me={hex !== null && hex === meHex}>
            <td>{label}</td>
            <td>{fight ? spireSlot(fight, 'stars', slot) : '-'}</td>
            <td>{fight ? spireSlot(fight, 'hits', slot) : '-'}</td>
            <td>{fight ? spireSlot(fight, 'dmg', slot).toLocaleString('en-US') : '-'}</td>
          </tr>;
        })}
      </tbody>
    </table>
    {(rewards.length > 0 || keepsakes.length > 0) && <ul aria-label="Rewards">
      {rewards.map((n) => <li key={n.seq}>{n.row.quantity} {getItemDef(n.row.itemId)?.name ?? n.row.itemId}</li>)}
      {keepsakes.map((n) => <li key={n.seq}>Keepsake: {COSMETICS[n.row.quantity]?.name ?? 'a keepsake'}</li>)}
    </ul>}
    {flawless && <p className="spire-flawless">Flawless!</p>}
    <button type="button" className="spire-close" onClick={onClose}>Close</button>
  </section>;
}
