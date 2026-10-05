import { PIECES } from '../../../shared/sim/frontier/catalog';
import type { Building, Crop } from '../../../shared/sim/frontier/model';

/** What a click on a placed piece can do. The scene maps each kind to a walk-then-act callback. */
export type PieceUse =
  | { kind: 'storage'; label: string }
  | { kind: 'craft'; label: string; disabled?: boolean }
  | { kind: 'plant'; label: string; disabled?: boolean }
  | { kind: 'harvest'; label: string; disabled?: boolean }
  | { kind: 'approach'; label: string };

/** Edge pieces sit on a tile border; the tile itself stays walkable. */
const BORDER_PIECES = new Set(['wall', 'window', 'fence', 'brick_wall', 'door', 'gate']);
/** Floors, rugs and doorways are walked on, so clicks pass through to the ground. */
const WALKED_ON = new Set(['floor', 'rug', 'roof', 'door', 'gate']);

export function pieceUses(b: Building, ctx: { canBuild: boolean; crop?: Crop; hasSeed: boolean; now: number }): PieceUse[] {
  const def = PIECES[b.piece];
  if (!def || BORDER_PIECES.has(b.piece) || WALKED_ON.has(b.piece)) return [];
  if (def.station === 'storage') return [{ kind: 'storage', label: 'Open storage' }];
  if (def.station === 'stable') return [{ kind: 'approach', label: `Walk to ${def.name.toLowerCase()}` }];
  if (def.station) return [{ kind: 'craft', label: ctx.canBuild ? `Craft at ${def.name.toLowerCase()}` : `Craft at ${def.name.toLowerCase()} · plot helpers only`, disabled: !ctx.canBuild }];
  if (b.piece === 'planter') {
    if (!ctx.canBuild) return [{ kind: 'approach', label: 'Walk to planter' }];
    if (ctx.crop) {
      const ripe = ctx.now >= ctx.crop.ripeAt;
      return [{ kind: 'harvest', label: ripe ? 'Harvest carrots' : `Carrots growing · ${Math.max(1, Math.ceil((ctx.crop.ripeAt - ctx.now) / 60_000))} min`, disabled: !ripe }];
    }
    return [{ kind: 'plant', label: ctx.hasSeed ? 'Plant a carrot seed' : 'Plant a carrot seed · need a seed', disabled: !ctx.hasSeed }];
  }
  return [{ kind: 'approach', label: `Walk to ${(b.label || def.name).toLowerCase()}` }];
}

/**
 * Whether a piece should catch clicks at all. Use actions are for everyone; rotate, move and
 * dismantle are for plot builders. Border pieces never catch clicks while you are inside that
 * home, so clicks reach the floor and you can walk to the chest and stations.
 */
export function pieceClickable(b: Building, ctx: { canBuild: boolean; indoors: boolean; hasUses: boolean }) {
  if (WALKED_ON.has(b.piece)) return false;
  if (BORDER_PIECES.has(b.piece)) return ctx.canBuild && !ctx.indoors;
  return ctx.hasUses || ctx.canBuild;
}

/** The hover prompt for the piece's first use, or the builder actions when it has none. */
export function pieceHoverAction(uses: PieceUse[], canBuild: boolean) {
  const first = uses[0];
  if (first?.kind === 'storage') return canBuild ? 'Click to open storage or rearrange' : 'Click to open storage';
  if (first?.kind === 'craft' && !first.disabled) return 'Click to craft here';
  if (first?.kind === 'plant' || first?.kind === 'harvest') return 'Click to tend the planter';
  return canBuild ? 'Click for options · rotate, move or dismantle' : 'Click to walk here';
}
