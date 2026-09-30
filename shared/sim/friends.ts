/**
 * Friends, "join me" invite links and chat filtering. Pure rules shared by the
 * SpacetimeDB module, the browser client and the agent API.
 */
import { BOULDER_LINE, HEDGE_RING, SPAWN_TILE } from './constants';
import { areaOf, isBramble, isBoulderLine, type Area } from './areas';
import { chebyshev, isLandTile, tileKey } from './grid';
import type { Tile } from './types';

// ---- Invite codes ----------------------------------------------------------
/** No 0/O, 1/I/L: easy to read aloud and type. 31 symbols, 8 of them: ~2^40 codes. */
export const INVITE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
export const INVITE_CODE_LEN = 8;
/** An invite link works for one hour (a beta character's lifetime); making a new one replaces it. */
export const INVITE_TTL_MICROS = 60n * 60n * 1_000_000n;
/** The URL query parameter carrying an invite code: ?join=CODE. */
export const INVITE_PARAM = 'join';
export const MAX_FRIENDS = 50;

/** A fresh code from a [0,1) random source (the server passes ctx.random). */
export function generateInviteCode(random: () => number): string {
  let s = '';
  for (let i = 0; i < INVITE_CODE_LEN; i++) {
    s += INVITE_ALPHABET[Math.floor(random() * INVITE_ALPHABET.length) % INVITE_ALPHABET.length];
  }
  return s;
}

/** Canonical form of a typed or pasted code, or null when it cannot be one. */
export function normalizeInviteCode(raw: string): string | null {
  const s = raw.trim().toUpperCase().replace(/[\s-]/g, '');
  if (s.length !== INVITE_CODE_LEN) return null;
  for (const ch of s) if (!INVITE_ALPHABET.includes(ch)) return null;
  return s;
}

/** The shareable link: the page URL with only ?join=CODE (never a token or identity). */
export function inviteUrl(base: string, code: string): string {
  const url = new URL(base);
  url.search = '';
  url.hash = '';
  url.searchParams.set(INVITE_PARAM, code);
  return url.toString();
}

/** Grove bounds: ring <= HEDGE_RING - 1. */
const GROVE_MIN = SPAWN_TILE.x - (HEDGE_RING - 1);
const GROVE_MAX = SPAWN_TILE.x + (HEDGE_RING - 1);
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export interface JoinSpot {
  tile: Tile;
  /** The inviter stands where the joiner may not go (past the brambles without a stick, or past the boulder line without a stone club). */
  clamped: boolean;
  /** When clamped: the barrier the joiner lacks the key for. */
  barrier?: 'brambles' | 'boulders';
}

/**
 * Where a joiner lands next to an inviter. Beside them when the joiner may be
 * where they are (Grove: always; hedge/Coast: with a stick; boulder line and
 * Boulders: with a stick and a stone club); otherwise the nearest tile of the
 * furthest area they may be in (the Grove, or the Coast below the boulder
 * line). Never on sea, a blocked tile or the inviter; a joiner without a
 * stick never lands on a bramble, one without a club never on the boulder line.
 */
export function joinSpot(inviter: Tile, hasStick: boolean, blocked: Set<number>, hasClub = false): JoinSpot {
  const allowed = (a: Area) => a === 'grove'
    || ((a === 'hedge' || a === 'coast') && hasStick)
    || ((a === 'boulder-line' || a === 'boulders') && hasStick && hasClub);
  const clamped = !allowed(areaOf(inviter));
  const barrier: JoinSpot['barrier'] = !clamped ? undefined : hasStick ? 'boulders' : 'brambles';
  const anchor = !clamped ? { x: inviter.x, z: inviter.z }
    : barrier === 'brambles'
      ? { x: clamp(inviter.x, GROVE_MIN, GROVE_MAX), z: clamp(inviter.z, GROVE_MIN, GROVE_MAX) }
      : { x: Math.min(inviter.x, BOULDER_LINE - 1), z: Math.min(inviter.z, BOULDER_LINE - 1) };
  const ok = (t: Tile) => isLandTile(t)
    && !blocked.has(tileKey(t)) && !(t.x === inviter.x && t.z === inviter.z)
    && (hasStick || !isBramble(t)) && (hasClub || !isBoulderLine(t)) && allowed(areaOf(t));
  for (let r = clamped ? 0 : 1; r <= 6; r++) {
    // Nearest to the inviter first, then a fixed order (deterministic).
    const ring: Tile[] = [];
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) === r) ring.push({ x: anchor.x + dx, z: anchor.z + dz });
      }
    }
    ring.sort((a, b) => chebyshev(a, inviter) - chebyshev(b, inviter) || a.z - b.z || a.x - b.x);
    for (const t of ring) if (ok(t)) return { tile: t, clamped, barrier };
  }
  return { tile: { ...SPAWN_TILE }, clamped: true, barrier: barrier ?? 'brambles' };
}

// ---- Chat -------------------------------------------------------------------
/** "Nearby" chat: messages said within this many tiles (Chebyshev) of where you stand now. */
export const CHAT_NEARBY_RADIUS = 12;
/** Speech bubbles show at most this many characters; the chat log keeps the whole line. */
export const CHAT_BUBBLE_MAX_CHARS = 80;
export type ChatMode = 'all' | 'nearby';

export interface ChatPlace { x: number; z: number }

/**
 * Whether a message shows in the log for `mode`. Each message records where
 * its sender stood when they said it (x = -1 on messages older than that
 * column: they count as far away).
 */
export function chatVisible(mode: ChatMode, me: Tile | null | undefined, said: ChatPlace): boolean {
  if (mode === 'all') return true;
  if (!me || said.x < 0 || said.z < 0) return false;
  return chebyshev(me, said) <= CHAT_NEARBY_RADIUS;
}

/** A speech bubble's text: one line, capped. */
export function bubbleText(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length <= CHAT_BUBBLE_MAX_CHARS ? flat : `${flat.slice(0, CHAT_BUBBLE_MAX_CHARS - 1).trimEnd()}…`;
}

// ---- Social notices (social_event.kind) ------------------------------------
export const SocialNotice = {
  Info: 0,
  FriendAdded: 1,
  InviteJoined: 2,
  TradeRequest: 3,
  TradeCancelled: 4,
  TradeDone: 5,
  TradeFailed: 6,
  /** Mentor rewards (shared/sim/mentor.ts). */
  Mentor: 7,
} as const;
export type SocialNotice = (typeof SocialNotice)[keyof typeof SocialNotice];
