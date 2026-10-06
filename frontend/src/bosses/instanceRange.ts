/**
 * Upload only the first `length` floats of an instanced attribute. three r159+ replaced
 * `updateRange` with `clearUpdateRanges`/`addUpdateRange` (removed entirely by r186); support both
 * so the bullet and danger layers work on either side of the dependency upgrade.
 */
export function markInstanceRange(attr: { needsUpdate: boolean }, length: number): void {
  const a = attr as any;
  if (typeof a.clearUpdateRanges === 'function' && typeof a.addUpdateRange === 'function') {
    a.clearUpdateRanges();
    a.addUpdateRange(0, length);
  } else if (a.updateRange) {
    a.updateRange.offset = 0;
    a.updateRange.count = length;
  }
}
