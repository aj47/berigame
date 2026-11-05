import { DEFAULT_HOLD_SECONDS } from './watchParams';

/**
 * The auto-director: which character the camera is on. Pure, stepped about once a second. A fight is scored from what
 * the rows show: health being lost, plus an attacker with a live target. A shot is held at least `holdMs` so it does
 * not jump around, and a new fight takes over only by being clearly hotter, unless the current one has gone cold.
 */
export interface DirectedPlayer {
  hex: string;
  hp: number;
  online: boolean;
  dead: boolean;
  /** Identity hex of who they are attacking. */
  target: string | null;
}

export interface DirectorOptions { holdMs?: number; idleMs?: number }

/** Health lost keeps a player hot for a while: half gone every 5 s. */
const HALF_LIFE_MS = 5000;
const TARGET_HEAT = 2;
/** How much hotter another fight must be to take the shot once it can be cut from. */
const CUT_MARGIN = 1.5;
/** Below this nothing counts as a fight. */
const COLD = 1;

export class Director {
  private heat = new Map<string, number>();
  private lastHp = new Map<string, number>();
  private last = 0;
  private cutAt = -Infinity;
  private subject: string | null = null;
  private seen: string[] = [];
  private readonly holdMs: number;
  private readonly idleMs: number;

  constructor(options: DirectorOptions = {}) {
    this.holdMs = options.holdMs ?? DEFAULT_HOLD_SECONDS * 1000;
    this.idleMs = options.idleMs ?? 20_000;
  }

  private warm(hex: string, by: number) { this.heat.set(hex, (this.heat.get(hex) ?? 0) + by); }

  /** The player to show at `now`, or null with nobody online. */
  step(players: readonly DirectedPlayer[], now: number): string | null {
    const decay = this.last ? 0.5 ** ((now - this.last) / HALF_LIFE_MS) : 1;
    this.last = now;
    for (const [hex, value] of this.heat) this.heat.set(hex, value * decay);

    const online = players.filter((p) => p.online);
    const byHex = new Set(online.map((p) => p.hex));
    for (const p of players) {
      const before = this.lastHp.get(p.hex);
      if (before !== undefined && p.hp < before) this.warm(p.hex, before - p.hp);
      this.lastHp.set(p.hex, p.hp);
    }
    for (const p of online) {
      if (p.target && byHex.has(p.target) && !p.dead) { this.warm(p.hex, TARGET_HEAT); this.warm(p.target, TARGET_HEAT); }
    }

    if (this.subject && !byHex.has(this.subject)) this.subject = null;
    const live = online.filter((p) => !p.dead);
    if (!this.subject) return this.cut(online, live, now);
    const held = now - this.cutAt;
    if (held < this.holdMs) return this.subject;

    const score = (hex: string) => this.heat.get(hex) ?? 0;
    const current = score(this.subject);
    const hottest = live.reduce<string | null>((best, p) => (best === null || score(p.hex) > score(best) ? p.hex : best), null);
    if (hottest && hottest !== this.subject && score(hottest) >= COLD && score(hottest) > current * CUT_MARGIN) return this.take(hottest, now);
    // Nothing is happening anywhere: keep moving around the cast.
    if (current < COLD && held >= this.idleMs) return this.cut(online, live, now);
    return this.subject;
  }

  private take(hex: string, now: number) {
    this.subject = hex;
    this.cutAt = now;
    this.seen = [...this.seen.filter((h) => h !== hex), hex];
    return hex;
  }

  /** The hottest player, else whoever has gone longest unseen. */
  private cut(online: readonly DirectedPlayer[], live: readonly DirectedPlayer[], now: number): string | null {
    const pool = live.length ? live : online;
    if (!pool.length) return null;
    const rank = (hex: string) => this.seen.indexOf(hex);
    const pick = [...pool].sort((a, b) => (this.heat.get(b.hex) ?? 0) - (this.heat.get(a.hex) ?? 0) || rank(a.hex) - rank(b.hex) || a.hex.localeCompare(b.hex))[0];
    const hot = (this.heat.get(pick.hex) ?? 0) >= COLD;
    if (hot) return this.take(pick.hex, now);
    const next = [...pool].sort((a, b) => rank(a.hex) - rank(b.hex) || a.hex.localeCompare(b.hex))[0];
    return this.take(next.hex, now);
  }
}
