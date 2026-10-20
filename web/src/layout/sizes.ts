/**
 * Log scale, so a 10,000-line file is only about twice as tall as a 100-line file.
 *   1 LOC → 1.5,  100 LOC → 8.3,  1,000 LOC → 12.3,  10,000 LOC → 16.2
 */
export function buildingHeight(loc: number): number {
  return 0.3 + Math.log2(loc + 1) * 1.2;
}

/** Footprint from file size (log scale), between 0.6 and 3. */
export function buildingWidth(bytes: number): number {
  return Math.min(3, 0.6 + Math.log10(bytes + 1) * 0.4);
}
