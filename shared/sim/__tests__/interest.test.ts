import { describe, expect, it } from 'vitest';
import {
  GLOBAL_CELL, NODE_BLOCK, PLAYER_BLOCK, blockCells, blockGroups, cellAt, eventCell, inInterestBlock, interestBlock, nextInterestBlock, nodeCell, playerCell,
  type BlockSpec,
} from '../interest';
import { GRID_SIZE } from '../constants';

/** The least distance from a client to its block's edge that a spec guarantees (one chunk less the slack). */
const margin = (spec: BlockSpec) => spec.chunk - (spec.slack ?? 0);

describe('interest blocks', () => {
  for (const [name, spec] of [['node', NODE_BLOCK], ['player', PLAYER_BLOCK]] as const) {
    it(`keeps the ${name} block at least ${margin(spec)} tiles around the client while walking, clamped to the map`, () => {
      expect(margin(spec)).toBeGreaterThanOrEqual(16);
      for (const [x, z] of [[0, 0], [25, 25], [131, 77], [255, 255], [200, 31]]) {
        const b = nextInterestBlock({ x, z }, undefined, spec);
        expect(inInterestBlock(b, { x, z })).toBe(true);
        expect(b.x0).toBeGreaterThanOrEqual(0); expect(b.x1).toBeLessThanOrEqual(GRID_SIZE);
      }
      // Walk east, north-west and back: the block always reaches `margin` tiles around you.
      let b = nextInterestBlock({ x: 30, z: 200 }, undefined, spec);
      let moves = 0;
      const path: [number, number][] = [];
      for (let x = 30; x < 230; x++) path.push([x, 200]);
      for (let i = 0; i < 150; i++) path.push([230 - i, 200 - i]);
      for (let i = 0; i < 150; i++) path.push([80 + i, 50 + i]);
      for (const [x, z] of path) {
        const n = nextInterestBlock({ x, z }, b);
        if (n !== b) moves++;
        b = n;
        for (const [dx, dz] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
          const t = { x: x + dx * margin(spec), z: z + dz * margin(spec) };
          if (t.x >= 0 && t.z >= 0 && t.x < GRID_SIZE && t.z < GRID_SIZE) expect(inInterestBlock(b, t), `${x},${z} -> ${t.x},${t.z}`).toBe(true);
        }
      }
      // Recentred about once per chunk border crossed on either axis (200 + 2 x 150 + 2 x 150 tiles of axis travel), never per step.
      expect(moves).toBeLessThanOrEqual(Math.ceil(800 / spec.chunk) + 2);
    });

    it(`does not thrash the ${name} block on a chunk border`, () => {
      const border = 4 * spec.chunk;
      const held = nextInterestBlock({ x: border - 1, z: 50 }, undefined, spec);
      for (let i = 0; i < 20; i++) expect(nextInterestBlock({ x: i % 2 ? border : border - 1, z: 50 }, held)).toBe(held);
      // Past the slack it moves.
      expect(nextInterestBlock({ x: border + (spec.slack ?? 0), z: 50 }, held)).not.toBe(held);
    });
  }

  it('gives clients in the same area the same query text, one equality per cell', () => {
    const a = blockGroups(nextInterestBlock({ x: 140, z: 120 }), 'nodes');
    expect(a).toEqual(blockGroups(nextInterestBlock({ x: 150, z: 110 }), 'nodes'));
    expect(a.size).toBe(9);
    const cell = nodeCell(140, 120);
    expect(a.get(`nodes:${cell}`)).toEqual([`SELECT * FROM tree WHERE cell = ${cell}`, `SELECT * FROM ground_item WHERE cell = ${cell}`]);
    const p = blockGroups(nextInterestBlock({ x: 140, z: 120 }, undefined, PLAYER_BLOCK), 'players');
    expect(p).toEqual(blockGroups(nextInterestBlock({ x: 136, z: 125 }, undefined, PLAYER_BLOCK), 'players'));
    const pc = playerCell('bramblewild', 140, 120);
    // The full player rows come through a join on player_pos: re-sent when a player row changes, not for a step.
    expect(p.get(`players:${pc}`)).toEqual([
      `SELECT * FROM player_pos WHERE cell = ${pc}`,
      `SELECT p.* FROM player p JOIN player_pos q ON p.identity = q.identity WHERE q.cell = ${pc}`,
    ]);
    // `local`: a player cell's players and events in one group.
    const local = blockGroups(nextInterestBlock({ x: 140, z: 120 }, undefined, PLAYER_BLOCK), 'local').get(`local:${pc}`)!;
    expect(local.slice(0, 2)).toEqual(p.get(`players:${pc}`));
    expect(local.slice(2)).toEqual(['combat_event', 'dummy_event', 'emote_event', 'giant_event'].map((t) => `SELECT * FROM ${t} WHERE cell = ${pc}`));
    expect(blockGroups(interestBlock('settlement', 1, 2), 'nodes').size).toBe(0);
    expect(blockGroups(interestBlock('settlement', 1, 2, PLAYER_BLOCK), 'players').size).toBe(9);
    expect(blockGroups(interestBlock('settlement', 0, 2, PLAYER_BLOCK), 'players').size).toBe(6); // clamped at x = 0
  });

  it('numbers cells per region and grid, clamps blocks to the region, and keeps GLOBAL_CELL for no place', () => {
    // Every tile of a block is in one of its cells, and the cells are distinct across regions and grids.
    const b = nextInterestBlock({ x: 130, z: 77 }, undefined, PLAYER_BLOCK);
    const cells = new Set(blockCells(b));
    for (let x = b.x0; x < b.x1; x++) for (let z = b.z0; z < b.z1; z++) expect(cells.has(playerCell('bramblewild', x, z))).toBe(true);
    expect(cells.has(playerCell('bramblewild', b.x1, b.z0))).toBe(false);
    expect(playerCell('settlement', 10, 10)).not.toBe(playerCell('bramblewild', 10, 10));
    expect(cellAt('bramblewild', 40, 30, NODE_BLOCK)).toBe(nodeCell(40, 30));
    expect(blockCells(nextInterestBlock({ x: 0, z: 0 }, undefined, PLAYER_BLOCK))).toHaveLength(4);
    expect(blockCells(nextInterestBlock({ region: 'reedwake', x: 127, z: 127 }, undefined, PLAYER_BLOCK))).toHaveLength(4);
    expect(blockCells(interestBlock('settlement', -10, 3, PLAYER_BLOCK))).toEqual([]);
    expect(eventCell(undefined, -1, -1)).toBe(GLOBAL_CELL);
    expect(eventCell(undefined, 0, 0)).not.toBe(GLOBAL_CELL);
    const all = new Set<number>();
    for (let x = 0; x < GRID_SIZE; x++) for (let z = 0; z < GRID_SIZE; z++) all.add(playerCell('bramblewild', x, z));
    expect(all.size).toBe(Math.ceil(GRID_SIZE / PLAYER_BLOCK.chunk) ** 2);
    expect(all.has(GLOBAL_CELL)).toBe(false);
  });
});
