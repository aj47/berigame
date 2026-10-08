/**
 * Clatterhorn FX: consumes new bossStore entries (YouHit and Hurt notices,
 * swing cues, the row's flips, landings, spins and drums, defeats and
 * rewards) into damage numbers, swing animations, knockback, sounds, toasts
 * and world lines (`useGiantStore.getState().addSystemLine`, `floatOnPlayer`).
 * BossSync starts it once per connection. Every sound carries the beetle's or
 * the player's world position and a `delayMs` aligned with the avatar
 * timeline (one tick behind the server).
 */
import { create } from 'zustand';
import {
  BossEventKind, BossId, BossNoticeKind, CLATTER_DIR8, ClatterState, clatterSlam, EventKind, HurtSource, getItemDef, tileToWorld,
  type ClatterRowLike,
} from '@sim';
import { attackPresentation } from '../../animation/combatPresentation';
import { locateAvatar } from '../../animation/avatarRegistry';
import { audio } from '../../audio';
import type { SfxName } from '../../audio/synth';
import { weaponWeight } from '../../fx/combatFx';
import { flashAt } from '../../fx/hitFlash';
import { reactAt } from '../../fx/hitReaction';
import { useCombatFxStore } from '../../spacetime/stores/combatFxStore';
import { floatOnPlayer, useGiantStore } from '../../spacetime/stores/giantStore';
import { useToastStore } from '../../spacetime/stores/toastStore';
import { tickClock } from '../../spacetime/tickClock';
import { useBossStore, type BossEventRow, type BossNoticeRow, type BossState, type ClatterhornRow, type SwingCue } from '../bossStore';
import { clatterWeaponOf } from './clatterPlayers';

/** Your latest landed blow on Clatterhorn (the floating number over it). */
export interface ClatterHit { seq: number; damage: number; flipped: boolean; itemId: string; at: number; delayMs: number }

interface ClatterFxState {
  seq: number;
  hit: ClatterHit | null;
  /** performance.now() of the latest landed swing by anyone (the beetle flinches). */
  flinchAt: number;
  /** performance.now() when the latest flip lands on the avatar timeline (runes flare). */
  flipAt: number;
}

export const useClatterFxStore = create<ClatterFxState>(() => ({ seq: 0, hit: null, flinchAt: -Infinity, flipAt: -Infinity }));

const HIT_SOUND: readonly SfxName[] = ['punch', 'stick', 'club'];
const HIT_TTL_MS = 1400;
/** Other players' swing cues use this negative range in combatFxStore (the Giant uses small negatives). */
const CUE_SEQ_BASE = 1_000_000_000;
const REWARD_GATHER_MS = 120;

export const CLATTER_LINES = {
  wake: 'Clatterhorn stirs in its glade',
  defeat: (helpers: number) => `Clatterhorn flips over and scuttles off into the brush! (${helpers} helper${helpers === 1 ? '' : 's'})`,
  respawn: 'Clatterhorn has dug its way back into the glade',
} as const;

/** The world line of a Clatterhorn boss_event, or null. */
export function clatterLineText(e: Pick<BossEventRow, 'boss' | 'kind' | 'quantity'>): string | null {
  if (e.boss !== BossId.Clatterhorn) return null;
  switch (e.kind) {
    case BossEventKind.ClatterWake: return CLATTER_LINES.wake;
    case BossEventKind.ClatterDefeat: return CLATTER_LINES.defeat(e.quantity);
    case BossEventKind.ClatterRespawn: return CLATTER_LINES.respawn;
    default: return null;
  }
}

export type ClatterRowCue = 'warn' | 'land' | 'flip' | 'spin' | 'drum';

const WINDUPS: ReadonlySet<number> = new Set([ClatterState.ChargeWindup, ClatterState.SpinWindup, ClatterState.DrumWindup]);

/** Moments shown by one clatterhorn row update (pure; the order of the result is the order they play). */
export function clatterRowCues(prev: ClatterRowLike | null, next: ClatterRowLike | null): ClatterRowCue[] {
  if (!prev || !next) return [];
  const out: ClatterRowCue[] = [];
  const moved = prev.x !== next.x || prev.z !== next.z;
  if (prev.state === ClatterState.ChargeWindup && moved) {
    out.push('land');
    if (next.state === ClatterState.Flipped) out.push('flip');
  }
  if (prev.state === ClatterState.SpinWindup && next.state !== ClatterState.SpinWindup) out.push('spin');
  if (next.state === ClatterState.Drumming && prev.state !== ClatterState.Drumming) out.push('drum');
  if (WINDUPS.has(next.state) && (prev.state !== next.state || prev.stateUntilTick !== next.stateUntilTick || moved)) out.push('warn');
  return out;
}

/** Runner travel direction by swarm side (N, E, S, W). */
const RUNNER_DIRS: readonly (readonly [number, number])[] = [[0, 1], [-1, 0], [0, -1], [1, 0]];

/** Unit-ish knockback direction for a Hurt notice: along the lane, away from the centre, or with the runners. */
export function hurtDirection(source: number, chargeDir: number, centre: { x: number; z: number }, me: { x: number; z: number } | null, swarmSide: number): [number, number] {
  if (source === HurtSource.Charge) { const d = CLATTER_DIR8[chargeDir & 7]; return [d[0], d[1]]; }
  if (source === HurtSource.Runner) { const d = RUNNER_DIRS[swarmSide & 3]; return [d[0], d[1]]; }
  if (!me) return [0, 0];
  return [me.x - centre.x, me.z - centre.z];
}

// ---- The consumer -------------------------------------------------------------------

/** The 'attacker' of Clatterhorn's blows for the hitstop map (never an avatar). */
const BEETLE_ID = 'clatterhorn';

function beetleWorld(row: ClatterhornRow | null): { x: number; z: number } | null {
  if (!row) return null;
  const [x, , z] = tileToWorld(row);
  return { x, z };
}

function playAtWorld(name: SfxName, where: { x: number; z: number } | null, volume: number, delayMs = 0): void {
  if (where) audio.play(name, { volume, delayMs, detune: 0.05, x: where.x, z: where.z });
}

function playAtPlayer(name: SfxName, hex: string, volume: number, delayMs = 0): void {
  const where = locateAvatar(hex);
  if (where) audio.play(name, { volume, delayMs, detune: 0.06, x: where.x, z: where.z });
  else audio.play(name, { volume: volume * 0.5, delayMs, detune: 0.06 });
}

/** Start consuming the store; returns the unsubscribe. */
export function startClatterFx(): () => void {
  const initial = useBossStore.getState();
  let lastNotice = initial.notices[initial.notices.length - 1]?.seq ?? 0;
  let lastEvent = initial.events[initial.events.length - 1]?.seq ?? 0;
  let lastCue = initial.swingCues[initial.swingCues.length - 1]?.seq ?? 0;
  let row: ClatterhornRow | null = initial.clatter;
  // The dir of the charge that landed most recently (a chained windup replaces row.dir in the same update).
  let landedDir = row?.dir ?? 0, landedTick = -1;
  let rewards: string[] = [];
  let keepsake = false;
  let rewardTimer: ReturnType<typeof setTimeout> | null = null;
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const later = (ms: number, fn: () => void) => {
    const t = setTimeout(() => { timers.delete(t); fn(); }, ms);
    timers.add(t);
  };

  const flushRewards = () => {
    rewardTimer = null;
    if (!rewards.length && !keepsake) return;
    const parts = [...rewards];
    if (keepsake) parts.push("the Clatterhorn keepsake");
    const list = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts[0];
    useToastStore.getState().show(`Clatterhorn is beaten! You earned ${list}`);
    rewards = []; keepsake = false;
  };

  const onRow = (next: ClatterhornRow | null) => {
    const prev = row;
    row = next;
    if (!prev || !next || prev === next) return;
    const period = tickClock.period;
    for (const cue of clatterRowCues(prev, next)) {
      const where = beetleWorld(next);
      switch (cue) {
        case 'warn': playAtWorld('warn', beetleWorld(next), 0.55); break;
        case 'land': landedDir = prev.dir; landedTick = tickClock.tick; playAtWorld('thud', where, 0.9, period); break;
        case 'flip':
          playAtWorld('crash', where, 1, period);
          useClatterFxStore.setState({ flipAt: performance.now() + period });
          break;
        case 'spin': playAtWorld(clatterSlam(prev) ? 'thud' : 'whoosh', where, 1, period); break;
        case 'drum':
          playAtWorld('skitter', where, 0.9, period);
          playAtWorld('skitter', where, 0.7, period * 3);
          break;
      }
    }
  };

  const onNotice = (n: BossNoticeRow, s: BossState) => {
    if (n.boss !== BossId.Clatterhorn) return;
    const me = s.meHex;
    const now = performance.now();
    switch (n.kind) {
      case BossNoticeKind.YouHit: {
        const weapon = (me && clatterWeaponOf(me)) ?? '';
        const attack = attackPresentation(EventKind.Hit, weapon);
        const delayMs = attack?.impactMs ?? 0;
        const flipped = s.clatter?.state === ClatterState.Flipped;
        const seq = useClatterFxStore.getState().seq + 1;
        useClatterFxStore.setState({ seq, flinchAt: now + delayMs, hit: { seq, damage: n.amount, flipped, itemId: weapon, at: now, delayMs } });
        later(HIT_TTL_MS + delayMs, () => { if (useClatterFxStore.getState().hit?.seq === seq) useClatterFxStore.setState({ hit: null }); });
        playAtWorld(HIT_SOUND[weaponWeight(weapon)], beetleWorld(s.clatter), 1, delayMs);
        break;
      }
      case BossNoticeKind.Hurt: {
        if (!me) break;
        const delayMs = (n.half / 2) * tickClock.period;
        const at = now + delayMs;
        floatOnPlayer(me, String(n.amount), n.amount);
        flashAt(me, at);
        const c = s.clatter;
        const centre = beetleWorld(c) ?? { x: 0, z: 0 };
        const chargeDir = landedTick === n.tick || c?.state !== ClatterState.ChargeWindup ? landedDir : c.dir;
        const [dx, dz] = hurtDirection(n.quantity, chargeDir, centre, locateAvatar(me), c?.swarmSide ?? 0);
        reactAt(me, BEETLE_ID, at, n.quantity === HurtSource.Runner ? 1 : 2, dx, dz);
        playAtPlayer(n.quantity === HurtSource.Runner ? 'stick' : 'club', me, 1, delayMs);
        break;
      }
      case BossNoticeKind.Reward: {
        const name = getItemDef(n.itemId)?.name ?? n.itemId;
        rewards.push(`${n.quantity} ${name.toLowerCase()}`);
        if (!rewardTimer) { rewardTimer = setTimeout(flushRewards, REWARD_GATHER_MS); }
        break;
      }
      case BossNoticeKind.Keepsake:
        keepsake = true;
        if (!rewardTimer) { rewardTimer = setTimeout(flushRewards, REWARD_GATHER_MS); }
        break;
    }
  };

  const onEvent = (e: BossEventRow, s: BossState) => {
    const line = clatterLineText(e);
    if (!line) return;
    useGiantStore.getState().addSystemLine(line);
    if (e.kind === BossEventKind.ClatterDefeat) {
      useToastStore.getState().show(line);
      playAtWorld('shatter', beetleWorld(s.clatter) ?? beetleWorld({ x: e.x, z: e.z } as ClatterhornRow), 1);
    }
  };

  const onCue = (cue: SwingCue, s: BossState) => {
    const now = performance.now();
    const weapon = clatterWeaponOf(cue.hex) ?? '';
    const attack = attackPresentation(EventKind.Hit, weapon);
    if (!attack) return;
    const seq = -(CUE_SEQ_BASE + cue.seq);
    const hex = cue.hex;
    useCombatFxStore.setState((st) => ({ cues: { ...st.cues, [hex]: { ...attack.attacker, role: 'action', at: now, seq } } }));
    later(attack.attacker.durationMs + 50, () => useCombatFxStore.setState((st) => {
      if (st.cues[hex]?.seq !== seq) return st;
      const cues = { ...st.cues };
      delete cues[hex];
      return { cues };
    }));
    if (hex === s.meHex) return; // your own blow: YouHit plays the impact and the number
    // A swinger you cannot see (no rendered avatar: inside the Spire, in the Meadows, culled) makes no sound;
    // the non-positional fallback would play it at full range.
    const where = locateAvatar(hex);
    if (!where) return;
    const weight = weaponWeight(weapon);
    playAtWorld('whoosh', where, weight ? 0.6 : 0.35, Math.max(0, attack.impactMs - (weight ? 230 : 120)));
    playAtWorld(HIT_SOUND[weight], beetleWorld(s.clatter), 0.7, attack.impactMs);
    useClatterFxStore.setState({ flinchAt: now + attack.impactMs });
  };

  const unsubscribe = useBossStore.subscribe((s) => {
    if (s.clatter !== row) onRow(s.clatter);
    if (s.notices.length && s.notices[s.notices.length - 1].seq > lastNotice) {
      for (const n of s.notices) if (n.seq > lastNotice) onNotice(n.row, s);
      lastNotice = s.notices[s.notices.length - 1].seq;
    }
    if (s.events.length && s.events[s.events.length - 1].seq > lastEvent) {
      for (const e of s.events) if (e.seq > lastEvent) onEvent(e.row, s);
      lastEvent = s.events[s.events.length - 1].seq;
    }
    if (s.swingCues.length && s.swingCues[s.swingCues.length - 1].seq > lastCue) {
      for (const c of s.swingCues) if (c.seq > lastCue) onCue(c, s);
      lastCue = s.swingCues[s.swingCues.length - 1].seq;
    }
  });

  return () => {
    unsubscribe();
    if (rewardTimer) clearTimeout(rewardTimer);
    for (const t of timers) clearTimeout(t);
    timers.clear();
  };
}
