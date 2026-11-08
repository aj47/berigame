import { useEffect, useMemo, useState } from 'react';
import {
  BossId, BossNoticeKind, COSMETICS, LANTERN_BOSS_NAME, SpireMemberState, SpireOutcome, SpireStage, TICK_MS, getItemDef, lanternSlot,
} from '@sim';
import { usePlayersByHex } from '../../spacetime/hooks';
import { useBossStore, type LanternRunRow } from '../bossStore';
import { resultVisible } from '../spire/SpireResult';
import { clock } from '../spire/SpireHud';
import { lanternRunMembers } from './LanternLobbyPanel';
import '../bosses.css';

/**
 * Lanternmaw's result card (`data-testid="lantern-result"`), SpireResult's
 * rules on the lantern tables: shown by membership while your member row is
 * Done or Out (or Left with your RunResult notice) and the run is Cleared or
 * Failed; a 1.2 s header, then the time, per-member hits, damage, flooded
 * ticks and caps, and your rewards. Dismissable.
 */
export type LanternResultProps = Record<string, never>;

/** The header of an ended run. */
export function lanternResultHeadline(run: Pick<LanternRunRow, 'stage' | 'outcome'>): string {
  if (run.stage === SpireStage.Cleared || run.outcome === SpireOutcome.Cleared) return `${LANTERN_BOSS_NAME} sinks into the mud`;
  switch (run.outcome) {
    case SpireOutcome.TimedOut: return 'The lure went dark: time ran out';
    case SpireOutcome.Wiped: return 'The party was dragged under';
    case SpireOutcome.Abandoned: return 'The party scattered';
    case SpireOutcome.Closed: return 'The Drowned Hollow was sealed';
    case SpireOutcome.Reset: return 'The Drowned Hollow was updated';
    default: return 'The run is over';
  }
}

export default function LanternResult(_props: LanternResultProps) {
  const member = useBossStore((s) => s.myLanternMember);
  const run = useBossStore((s) => s.myLanternRun);
  const gotResult = useBossStore((s) => !!s.myLanternRun && s.notices.some((n) => n.row.boss === BossId.Lanternmaw && n.row.kind === BossNoticeKind.RunResult && n.row.runId === s.myLanternRun!.id));
  const [dismissed, setDismissed] = useState<string | null>(null);
  if (!run || !resultVisible(member, run, gotResult) || dismissed === String(run.id)) return null;
  return <ResultCard run={run} onClose={() => setDismissed(String(run.id))} />;
}

function ResultCard({ run, onClose }: { run: LanternRunRow; onClose: () => void }) {
  const fight = useBossStore((s) => s.lanternFight);
  const members = useBossStore((s) => s.lanternMembers);
  const meHex = useBossStore((s) => s.meHex);
  const notices = useBossStore((s) => s.notices);
  const players = usePlayersByHex();
  const [intro, setIntro] = useState(true);
  useEffect(() => { const t = setTimeout(() => setIntro(false), 1200); return () => clearTimeout(t); }, []);

  const headline = lanternResultHeadline(run);
  const cleared = run.stage === SpireStage.Cleared;
  const bySlot = useMemo(() => {
    const found = new Map(lanternRunMembers(members, run.id).map(([hex, m]) => [m.slot, { hex, state: m.state }] as const));
    return Array.from({ length: Math.max(run.partySize, found.size) }, (_, slot) => ({ slot, hex: found.get(slot)?.hex ?? null, state: found.get(slot)?.state ?? null }));
  }, [members, run.id, run.partySize]);
  const mine = notices.filter((n) => n.row.boss === BossId.Lanternmaw && n.row.runId === run.id);
  const rewards = mine.filter((n) => n.row.kind === BossNoticeKind.Reward);
  const keepsakes = mine.filter((n) => n.row.kind === BossNoticeKind.Keepsake);

  if (intro) {
    return <section className="spire-result lantern-result is-intro" data-testid="lantern-result" role="dialog" aria-label="Lanternmaw result"><h2>{headline}</h2></section>;
  }
  return <section className="spire-result lantern-result" data-testid="lantern-result" role="dialog" aria-label="Lanternmaw result">
    <h2>{headline}</h2>
    <p className="spire-result-sub">{cleared ? `Cleared in ${clock((run.clearTicks * TICK_MS) / 1000)}` : 'No reward this time'}</p>
    <table>
      <thead><tr><th>Member</th><th>Hits</th><th>Damage</th><th>Flooded</th><th>Caps</th></tr></thead>
      <tbody>
        {bySlot.map(({ slot, hex, state }) => {
          const name = hex ? (players.get(hex)?.name || 'Someone') : 'left';
          const label = state === SpireMemberState.Left ? `${name} (left)` : state === SpireMemberState.Out ? `${name} (knocked out)` : name;
          const col = (k: 'hits' | 'dmg' | 'drowned' | 'caps') => (fight ? lanternSlot(fight, k, slot).toLocaleString('en-US') : '-');
          return <tr key={slot} data-me={hex !== null && hex === meHex}>
            <td>{label}</td><td>{col('hits')}</td><td>{col('dmg')}</td><td>{col('drowned')}</td><td>{col('caps')}</td>
          </tr>;
        })}
      </tbody>
    </table>
    {(rewards.length > 0 || keepsakes.length > 0) && <ul aria-label="Rewards">
      {rewards.map((n) => <li key={n.seq}>{n.row.quantity} {getItemDef(n.row.itemId)?.name ?? n.row.itemId}</li>)}
      {keepsakes.map((n) => <li key={n.seq}>Keepsake: {COSMETICS[n.row.quantity]?.name ?? 'a keepsake'}</li>)}
    </ul>}
    <button type="button" className="spire-close" onClick={onClose}>Close</button>
  </section>;
}
