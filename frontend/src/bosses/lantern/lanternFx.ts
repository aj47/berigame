import { BossEventKind, BossId, BossNoticeKind, COSMETICS, SpireStage, TICK_MS, getItemDef, lanternSlot } from '@sim';
import { audio } from '../../audio';
import { flashAt } from '../../fx/hitFlash';
import { tickClock } from '../../spacetime/tickClock';
import { floatOnPlayer, useGiantStore } from '../../spacetime/stores/giantStore';
import { useToastStore } from '../../spacetime/stores/toastStore';
import { useBossStore, type BossEventRow, type BossNoticeRow, type BossState, type LanternFightRow } from '../bossStore';

/**
 * Lanternmaw FX, spireFx's rules for boss 3: your Hurt notices (any source)
 * flash and float the damage, KnockedOut / Reward / Keepsake toast, the world
 * hears LanternClear, LanternOpened and LanternSoon, and teammates' hits
 * flash from hits{slot} increments on your run's fight row. Started once per
 * connection by BossSync.
 */

const clearTime = (ticks: number) => {
  const s = Math.max(0, Math.round((ticks * TICK_MS) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/** The world line of a clear: "Ada's party drove Lanternmaw down in 4:12". */
export function lanternClearLine(e: Pick<BossEventRow, 'text' | 'quantity' | 'value'>): string {
  const first = (e.text || '').split(', ')[0] || 'A party';
  const who = e.quantity > 1 ? `${first}'s party` : first;
  return `${who} drove Lanternmaw down in ${clearTime(e.value)}`;
}

function onNotice(n: BossNoticeRow, meHex: string | null): void {
  if (n.boss !== BossId.Lanternmaw || !meHex) return;
  const toast = useToastStore.getState().show;
  switch (n.kind) {
    case BossNoticeKind.Hurt:
      flashAt(meHex, performance.now() + tickClock.period / 2);
      floatOnPlayer(meHex, String(n.amount), n.amount);
      audio.play('punch', { volume: 0.5 });
      break;
    case BossNoticeKind.KnockedOut:
      toast('Lanternmaw knocked you out of the Drowned Hollow. Your bag is safe');
      break;
    case BossNoticeKind.Reward: {
      const name = getItemDef(n.itemId)?.name ?? n.itemId;
      toast(`Lanternmaw reward: ${n.quantity} ${name.toLowerCase()}`);
      break;
    }
    case BossNoticeKind.Keepsake:
      toast(`Keepsake unlocked: ${COSMETICS[n.quantity]?.name ?? 'a keepsake'}`);
      audio.play('levelup', { volume: 0.7 });
      break;
  }
}

function onEvent(e: BossEventRow, s: BossState): void {
  if (e.boss !== BossId.Lanternmaw) return;
  const line = useGiantStore.getState().addSystemLine;
  if (e.kind === BossEventKind.LanternClear) {
    line(lanternClearLine(e));
    if (s.myLanternRun && e.runId === s.myLanternRun.id) audio.play('shatter', { volume: 0.9 });
  } else if (e.kind === BossEventKind.LanternOpened) {
    line('The Fen Gate is open: Lanternmaw stirs in the Drowned Hollow');
  } else if (e.kind === BossEventKind.LanternSoon) {
    line(`The Fen Gate opens in ${e.value} ${e.value === 1 ? 'minute' : 'minutes'}`);
  }
}

function onFight(prev: LanternFightRow | null, next: LanternFightRow | null, s: BossState): void {
  if (!prev || !next || prev.runId !== next.runId) return;
  if (next.phase > prev.phase) audio.play('shatter', { volume: 0.7 });
  const run = s.myLanternRun;
  if (!run || run.stage !== SpireStage.Active) return;
  for (const [hex, m] of s.lanternMembers) {
    if (m.runId !== run.id || hex === s.meHex) continue;
    if (lanternSlot(next, 'hits', m.slot) > lanternSlot(prev, 'hits', m.slot)) flashAt(hex, performance.now() + tickClock.period / 2);
  }
}

/** Start consuming the store; returns the unsubscribe. */
export function startLanternFx(): () => void {
  const s0 = useBossStore.getState();
  let noticeSeq = s0.notices.length ? s0.notices[s0.notices.length - 1].seq : 0;
  let eventSeq = s0.events.length ? s0.events[s0.events.length - 1].seq : 0;
  let fight = s0.lanternFight;
  return useBossStore.subscribe((s) => {
    if (s.seq < Math.max(noticeSeq, eventSeq)) { noticeSeq = 0; eventSeq = 0; }
    for (const n of s.notices) if (n.seq > noticeSeq) onNotice(n.row, s.meHex);
    if (s.notices.length) noticeSeq = Math.max(noticeSeq, s.notices[s.notices.length - 1].seq);
    for (const e of s.events) if (e.seq > eventSeq) onEvent(e.row, s);
    if (s.events.length) eventSeq = Math.max(eventSeq, s.events[s.events.length - 1].seq);
    if (s.lanternFight !== fight) { onFight(fight, s.lanternFight, s); fight = s.lanternFight; }
  });
}
