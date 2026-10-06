import {
  BossEventKind, BossId, BossNoticeKind, COSMETICS, SpireStage, TICK_MS, getItemDef, spireBulletDamage, spireEnraged, spireSlot,
} from '@sim';
import { audio } from '../../audio';
import { flashAt } from '../../fx/hitFlash';
import { tickClock } from '../../spacetime/tickClock';
import { floatOnPlayer, useGiantStore } from '../../spacetime/stores/giantStore';
import { useToastStore } from '../../spacetime/stores/toastStore';
import { useBossStore, type BossEventRow, type BossNoticeRow, type BossState, type SpireFightRow } from '../bossStore';

/**
 * Spire FX: consumes new bossStore entries (Star, Hurt, KnockedOut, Reward,
 * Keepsake notices; SpireClear events; your run's fight row) into hit
 * flashes, damage numbers, sounds, toasts and world lines
 * (`useGiantStore.getState().addSystemLine`). Sounds play per event, never
 * per bullet. BossSync starts it once per connection.
 */

/** "4:12" from ticks. */
const clearTime = (ticks: number) => {
  const s = Math.max(0, Math.round((ticks * TICK_MS) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/** The world line of a Spire clear: "Ada's party cleared the Sunken Spire in 4:12". */
export function spireClearLine(e: Pick<BossEventRow, 'text' | 'quantity' | 'value'>): string {
  const first = (e.text || '').split(', ')[0] || 'A party';
  const who = e.quantity > 1 ? `${first}'s party` : first;
  return `${who} cleared the Sunken Spire in ${clearTime(e.value)}`;
}

function onNotice(n: BossNoticeRow, meHex: string | null): void {
  if (n.boss !== BossId.Spire || !meHex) return;
  const toast = useToastStore.getState().show;
  switch (n.kind) {
    case BossNoticeKind.Star:
      floatOnPlayer(meHex, `+${n.amount}`, n.amount);
      break;
    case BossNoticeKind.Hurt: {
      // The avatar trails the server by a tick: the flash lands with the half-step that hit.
      const delayMs = (Math.max(1, n.half) / 2) * tickClock.period;
      flashAt(meHex, performance.now() + delayMs);
      floatOnPlayer(meHex, String(n.amount), n.amount);
      audio.play('punch', { volume: 0.5, delayMs });
      break;
    }
    case BossNoticeKind.KnockedOut:
      toast('You were knocked out of the Sunken Spire. Your bag is safe');
      break;
    case BossNoticeKind.Reward: {
      const name = getItemDef(n.itemId)?.name ?? n.itemId;
      toast(`Spire reward: ${n.quantity} ${name.toLowerCase()}`);
      break;
    }
    case BossNoticeKind.Keepsake:
      toast(`Keepsake unlocked: ${COSMETICS[n.quantity]?.name ?? 'a keepsake'}`);
      audio.play('levelup', { volume: 0.7 });
      break;
  }
}

function onEvent(e: BossEventRow, s: BossState): void {
  if (e.boss !== BossId.Spire) return;
  if (e.kind === BossEventKind.SpireClear) {
    useGiantStore.getState().addSystemLine(spireClearLine(e));
    if (s.myRun && e.runId === s.myRun.id) audio.play('shatter', { volume: 0.9 });
  }
}

/** Teammates' hits come from hits{slot} increments on your run's fight row; a phase change shatters. */
function onFight(prev: SpireFightRow | null, next: SpireFightRow | null, s: BossState): void {
  if (!prev || !next || prev.runId !== next.runId) return;
  if (next.phase > prev.phase) audio.play('shatter', { volume: 0.7 });
  const run = s.myRun;
  if (!run || run.stage !== SpireStage.Active) return;
  const damage = spireBulletDamage(next.phase, spireEnraged(run.startTick, tickClock.tick));
  for (const [hex, m] of s.members) {
    if (m.runId !== run.id || hex === s.meHex) continue;
    if (spireSlot(next, 'hits', m.slot) > spireSlot(prev, 'hits', m.slot)) {
      flashAt(hex, performance.now() + tickClock.period / 2);
      floatOnPlayer(hex, String(damage), damage);
    }
  }
}

/** Start consuming the store; returns the unsubscribe. */
export function startSpireFx(): () => void {
  const s0 = useBossStore.getState();
  let noticeSeq = s0.notices.length ? s0.notices[s0.notices.length - 1].seq : 0;
  let eventSeq = s0.events.length ? s0.events[s0.events.length - 1].seq : 0;
  let fight = s0.fight;
  return useBossStore.subscribe((s) => {
    // A store reset restarts the sequence numbers.
    if (s.seq < Math.max(noticeSeq, eventSeq)) { noticeSeq = 0; eventSeq = 0; }
    for (const n of s.notices) if (n.seq > noticeSeq) onNotice(n.row, s.meHex);
    if (s.notices.length) noticeSeq = Math.max(noticeSeq, s.notices[s.notices.length - 1].seq);
    for (const e of s.events) if (e.seq > eventSeq) onEvent(e.row, s);
    if (s.events.length) eventSeq = Math.max(eventSeq, s.events[s.events.length - 1].seq);
    if (s.fight !== fight) { onFight(fight, s.fight, s); fight = s.fight; }
  });
}
