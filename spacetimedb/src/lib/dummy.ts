import { DUMMY_ID, DUMMY_MAX_HP, DUMMY_TILE } from '../../../shared/sim';
import type { Ctx } from './types';

/** Insert the Grove's training dummy if it is missing (idempotent; the tick calls it too). */
export function ensureDummy(ctx: Ctx) {
  const row = ctx.db.trainingDummy.id.find(DUMMY_ID);
  if (row) return row;
  return ctx.db.trainingDummy.insert({ id: DUMMY_ID, x: DUMMY_TILE.x, z: DUMMY_TILE.z, hp: DUMMY_MAX_HP, maxHp: DUMMY_MAX_HP, lastHitTick: 0 });
}
