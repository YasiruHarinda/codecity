import type { CityLayout } from "./types";

export interface Lamp {
  x: number;
  z: number;
  /** Road height at the lamp. */
  y: number;
}

/** Distance between lamps along a sidewalk edge. */
const SPACING = 2.5;
/** Lamps stand on the road, just outside the curb. */
const CURB_OFFSET = 0.08;
/** Lamp budget — like the trees, so huge repos stay fast. */
const MAX_LAMPS = 8000;

/**
 * Street lamps along the edge of every sidewalk slab, standing on the road just outside the curb.
 * If the city has more sidewalk edge than the budget allows, the lamps are spaced further apart.
 */
export function placeLamps(layout: CityLayout): Lamp[] {
  const totalEdge = layout.lots.reduce((sum, lot) => sum + 2 * (lot.rect.w + lot.rect.h), 0);
  const spacing = Math.max(SPACING, totalEdge / MAX_LAMPS);

  const lamps: Lamp[] = [];
  for (const lot of layout.lots) {
    const { x, y: z, w, h } = lot.rect;
    const o = CURB_OFFSET;
    // The four edges, each pushed out onto the road: [start x, start z, direction x, direction z, length].
    const edges: [number, number, number, number, number][] = [
      [x, z - o, 1, 0, w], // back
      [x, z + h + o, 1, 0, w], // front
      [x - o, z, 0, 1, h], // left
      [x + w + o, z, 0, 1, h], // right
    ];
    for (const [sx, sz, dx, dz, length] of edges) {
      const count = Math.floor(length / spacing);
      // Evenly spaced along the edge, with half a gap at each end (so corners don't get two lamps).
      for (let i = 0; i < count; i++) {
        const along = ((i + 0.5) * length) / count;
        lamps.push({ x: sx + dx * along, z: sz + dz * along, y: lot.baseY });
      }
    }
  }
  return lamps;
}
