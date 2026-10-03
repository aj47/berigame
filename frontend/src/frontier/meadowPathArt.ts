const smooth = (from: number, to: number, value: number) => {
  const t = Math.max(0, Math.min(1, (value - from) / (to - from)));
  return t * t * (3 - 2 * t);
};

/** Visual trail wear only: the land, parcel bounds and walking routes stay fixed. */
export function meadowTrailDistance(x: number, z: number) {
  // Keep the main north/south lane easy to follow, softening its coastal ends.
  const spineWidth = 1.03 + .07 * Math.sin(z * .19);
  const spineEnd = 1.3 * (1 - smooth(2, 9, z) + smooth(113, 122, z));
  let road = Math.abs(x - 31) / spineWidth + spineEnd;

  for (let row = 0; row < 6; row++) {
    // These are the existing parcel approaches, including the bend east of town.
    const center = row === 3 ? 64 - Math.min(1, Math.max(0, (x - 31) / 4)) : 6 + row * 19;
    const width = 1.18 + .12 * Math.sin(x * .12 + row * 1.3) + .07 * Math.sin(x * .35 - row);
    const wear = .18 + .07 * Math.sin(x * .17 + row * .8) + .04 * Math.sin(x * .71 + row * 2);
    // Worn grass returns at the unused tips instead of a hard, ruler-cut stop.
    const end = 1.4 * (1 - smooth(3, 12, x) + smooth(95, 103, x));
    road = Math.min(road, Math.abs(z - center) / width + wear + end);
  }

  // The harbour-to-steward approach is the strongest path on the island seam.
  if (x <= 32) road = Math.min(road, Math.abs(z - 64) / 1.1);
  return road;
}
