/** Storage adapter for tests: real reducers, in-memory rows and indexes. */
export function testTable(primary = 'id', auto = false) {
  const rows = new Map<any, any>(); let next = 1n;
  const key = (v: any) => v?.toHexString ? v.toHexString() : v;
  const put = (row: any) => { rows.set(key(row[primary]), { ...row }); return { ...row }; };
  const base = { rows, iter: () => rows.values(), count: () => BigInt(rows.size), insert: (row: any) => put(auto ? { ...row, [primary]: next++ } : row) };
  return new Proxy(base, { get: (obj: any, field: string) => field in obj ? obj[field] : { find: (id: any) => rows.get(key(id)), update: put, delete: (id: any) => rows.delete(key(id)), filter: (id: any) => [...rows.values()].filter(r => key(r[field]) === key(id)) } }) as any;
}
export function adventureTables() { return { frontierObject: testTable('key'), frontierPrivate: testTable('key'), frontierView: testTable('key'), expeditionCredit: testTable('key'), adventureProfile: testTable('identity'), expedition: testTable('id', true), expeditionMember: testTable('identity'), islandProject: testTable(), gardenShowcase: testTable('identity'), friendlyDuel: testTable('id', true), playerSkill: testTable('identity'), playerCosmetic: testTable('identity'),
  // Bosses (FINAL_SPEC 4.1): config and Clatterhorn rows by id, credit by identity, Spire runs autoInc, events autoInc.
  bossConfig: testTable(), clatterhorn: testTable(), clatterhornCredit: testTable('identity'), spireRun: testTable('id', true), spireMember: testTable('identity'), spireFight: testTable('runId'), bossEvent: testTable('id', true), bossNotice: testTable('id', true) }; }

/**
 * `player` and `player_pos` (spacetimedb/src/lib/playerStore.ts) for the real-tick harnesses.
 * Tests edit a character as one row: a direct `player` write also moves its `player_pos`
 * row, as an owner editing both would (the server itself always writes a player row
 * with its live position, so this changes nothing for its own writes). Read characters
 * with `mergedPlayer`, which overlays the live position like the server does.
 */
export function playerTables() {
  const player = testTable('identity'), playerPos = testTable('identity');
  const mirror = (row: any) => {
    const pos = playerPos.identity.find(row.identity);
    // Offline characters have no player_pos row (the server folds it back when they leave).
    if (pos && !row.online) { playerPos.identity.delete(row.identity); return; }
    if (!pos) return;
    playerPos.identity.update({
      ...pos, region: row.region || 'bramblewild', x: row.x, z: row.z, facing: row.facing ?? pos.facing, targetX: row.targetX, targetZ: row.targetZ,
      lastInputTick: row.lastInputTick ?? pos.lastInputTick, inputsThisTick: row.inputsThisTick ?? pos.inputsThisTick,
    });
  };
  const wrapped = new Proxy(player, {
    get(obj: any, field: string) {
      if (field !== 'identity') return obj[field];
      const idx = obj.identity;
      return { ...idx, update: (row: any) => { const out = idx.update(row); mirror(row); return out; } };
    },
  });
  return { player: wrapped, playerPos };
}

/** A character as the server reads it: its player row with the live player_pos columns on top. */
export function mergedPlayer(db: any, who: any): any {
  const row = db.player.identity.find(who);
  const pos = row && db.playerPos?.identity.find(who);
  if (!row || !pos) return row;
  const { identity: _i, region: _r, ...motion } = pos;
  return { ...row, ...motion };
}
