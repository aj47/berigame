import { describe, expect, it } from 'vitest';
import { testTable } from './adventureHarness';
import { INVENTORY_SIZE, OBSIDIAN_ITEM_ID, SPIRE_EXIT, inSpireFloor } from '../index';
import { dropOnGround, giveItem } from '../../../spacetimedb/src/lib/inventory';

const id = (n: number) => { const hex = n.toString(16).padStart(64, '0'); return { toHexString: () => hex, __identity__: BigInt(n) } as any; };

function world() {
  const db: any = { inventorySlot: testTable('id', true), groundItem: testTable('id', true), frontierObject: testTable('key'), playStats: testTable('identity') };
  const ctx: any = { db, timestamp: { microsSinceUnixEpoch: 1_000_000_000_000n } };
  const who = id(1);
  // A full bag: no slot can take obsidian.
  for (let slot = 0; slot < INVENTORY_SIZE; slot++) db.inventorySlot.insert({ id: 0n, owner: who, slot, itemId: 'stick', quantity: 1 });
  return { ctx, db, who };
}

describe('drops never land on the sealed Spire floor', () => {
  it('a raid reward paid to a full bag inside the Spire overflows at the gate exit', () => {
    const { ctx, db, who } = world();
    const inside = { region: 'bramblewild', x: 72, z: 57 };
    expect(inSpireFloor(inside)).toBe(true);
    expect(giveItem(ctx, who, OBSIDIAN_ITEM_ID, 6, inside, 500)).toBe(0);
    expect([...db.groundItem.iter()].map((g: any) => [g.itemId, g.quantity, g.x, g.z])).toEqual([[OBSIDIAN_ITEM_ID, 6, SPIRE_EXIT.x, SPIRE_EXIT.z]]);
  });

  it('other drops stay where they fall, and other regions keep their own coordinates', () => {
    const { ctx, db, who } = world();
    dropOnGround(ctx, who, OBSIDIAN_ITEM_ID, 1, { region: 'bramblewild', x: 40, z: 30 }, 500);
    expect([...db.groundItem.iter()].map((g: any) => [g.x, g.z])).toEqual([[40, 30]]);
    dropOnGround(ctx, who, OBSIDIAN_ITEM_ID, 1, { region: 'settlement', x: 72, z: 57 }, 500);
    const bag = [...db.frontierObject.iter()].map((r: any) => JSON.parse(r.data));
    expect(bag.map((d: any) => [d.region, d.x, d.z])).toEqual([['settlement', 72, 57]]);
  });
});
