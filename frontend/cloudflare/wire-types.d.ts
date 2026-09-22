/** Wrangler resolves this internal SDK schema to the same SDK source instance. */
declare module '#spacetime-wire' {
  const protocol: Record<string, { algebraicType: import('spacetimedb').AlgebraicTypeType }>;
  export = protocol;
}
