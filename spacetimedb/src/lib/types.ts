import type { InferSchema, ReducerCtx } from 'spacetimedb/server';
import type spacetimedb from '../schema';

export type Ctx = ReducerCtx<InferSchema<typeof spacetimedb>>;
export type PlayerRow = NonNullable<ReturnType<Ctx['db']['player']['identity']['find']>>;
export type TreeRow = NonNullable<ReturnType<Ctx['db']['tree']['id']['find']>>;
export type GroundItemRow = NonNullable<ReturnType<Ctx['db']['groundItem']['id']['find']>>;
export type InventorySlotRow = NonNullable<ReturnType<Ctx['db']['inventorySlot']['id']['find']>>;
export type WorldRow = NonNullable<ReturnType<Ctx['db']['world']['id']['find']>>;
