/** Storage adapter for tests: real reducers, in-memory rows and indexes. */
export function testTable(primary = 'id', auto = false) {
  const rows = new Map<any, any>(); let next = 1n;
  const key = (v: any) => v?.toHexString ? v.toHexString() : v;
  const put = (row: any) => { rows.set(key(row[primary]), { ...row }); return { ...row }; };
  const base = { rows, iter: () => rows.values(), count: () => BigInt(rows.size), insert: (row: any) => put(auto ? { ...row, [primary]: next++ } : row) };
  return new Proxy(base, { get: (obj: any, field: string) => field in obj ? obj[field] : { find: (id: any) => rows.get(key(id)), update: put, delete: (id: any) => rows.delete(key(id)), filter: (id: any) => [...rows.values()].filter(r => key(r[field]) === key(id)) } }) as any;
}
export function adventureTables() { return { frontierObject: testTable('key'), frontierPrivate: testTable('key'), frontierView: testTable('key'), expeditionCredit: testTable('key'), adventureProfile: testTable('identity'), expedition: testTable('id', true), expeditionMember: testTable('identity'), islandProject: testTable(), gardenShowcase: testTable('identity'), friendlyDuel: testTable('id', true), playerSkill: testTable('identity'), playerCosmetic: testTable('identity') }; }
