/**
 * Append-only history of validated Lanternmaw pattern tables (BOSSES.md 9.8).
 * Each entry pairs `lanternPatternTableHash()` with the LANTERN_RULES_VERSION
 * it shipped under. lanternmaw-patterns.test.ts requires the current hash to be
 * the last entry and its `rules` to equal LANTERN_RULES_VERSION; when the hash
 * is new and the full sweep passes, it prints the line to append.
 * Never edit or remove an entry.
 */
export const LANTERN_VALIDATED: readonly { hash: string; rules: number }[] = [
  { hash: '5f69cc7e', rules: 1 },
];
