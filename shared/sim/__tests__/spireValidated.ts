/**
 * Append-only history of validated Spire pattern tables (FINAL_SPEC 10.1).
 * Each entry pairs `spirePatternTableHash()` with the `SPIRE_RULES_VERSION` it
 * shipped under. spire-patterns.test.ts requires the current hash to be the
 * last entry and its `rules` to equal SPIRE_RULES_VERSION; when the hash is
 * new it runs the full 46,464-instance sweep and prints the line to append.
 * Never edit or remove an entry.
 */
export const SPIRE_VALIDATED: readonly { hash: string; rules: number }[] = [
  { hash: '005949d2', rules: 1 },
];
