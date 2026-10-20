import type { Building, CityLayout } from "./types";

/** A square of lawn on a sidewalk slab. */
export interface GrassTile {
  x: number;
  z: number;
  /** Top of the slab it lies on. */
  y: number;
  size: number;
}

export interface Tree {
  x: number;
  z: number;
  /** Ground height at the tree. */
  y: number;
  /** Overall size multiplier (trees aren't all the same size). */
  scale: number;
  /** 0..1, picks a shade of green. */
  tint: number;
}

/** Grid size for finding free space; also the size of each grass tile. */
const TILE = 0.7;
/** Minimum distance between a grass tile and a building. */
const CLEARANCE = 0.12;
/** Sidewalk kept free along a slab's edge. */
const EDGE = 0.12;
/** Chance that a grass tile also gets a tree. */
const TREE_CHANCE = 0.5;
/** How far a tree may be nudged off its tile's centre. */
const JITTER = 0.15;
/**
 * Tree budgets. Every tree is drawn twice (once for the picture, once for the shadow map),
 * so a huge repo with lots of free space could otherwise plant 60,000+ trees and slow everything down.
 */
const MAX_CITY_TREES = 12000;
const MAX_BELT_TREES = 4000;

/**
 * Turns leftover space into parks.
 *
 * For every sidewalk slab, an imaginary grid of tiles is laid over it. A tile that is clear of every
 * building on the slab becomes grass, and about half of those get a tree. Neighbouring free tiles
 * join into lawns, so parks appear wherever there's room — narrow gaps stay as pavement.
 *
 * Deleted files (time-travel "ghosts") are buildings in the layout too, so their plots stay free
 * of trees and never collide when those buildings reappear in the past.
 *
 * Also plants a belt of trees on the grass around the city. Uses seeded randomness, so the same
 * city always gets the same parks.
 */
export function placeParks(layout: CityLayout): { grass: GrassTile[]; trees: Tree[] } {
  const random = seededRandom(7);
  const grass: GrassTile[] = [];
  const trees: Tree[] = [];

  // Which buildings stand on which slab: a lot holds the files of exactly one folder.
  const buildingsByFolder = new Map<string, Building[]>();
  for (const building of layout.buildings) {
    const path = building.file.path;
    const folder = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
    let list = buildingsByFolder.get(folder);
    if (!list) buildingsByFolder.set(folder, (list = []));
    list.push(building);
  }

  for (const lot of layout.lots) {
    const buildings = buildingsByFolder.get(lot.folder.path) ?? [];
    const top = lot.baseY + lot.thickness;
    const { x, y, w, h } = lot.rect;
    const columns = Math.floor((w - 2 * EDGE) / TILE);
    const rows = Math.floor((h - 2 * EDGE) / TILE);
    // Centre the grid on the slab.
    const startX = x + (w - columns * TILE) / 2 + TILE / 2;
    const startZ = y + (h - rows * TILE) / 2 + TILE / 2;

    for (let row = 0; row < rows; row++) {
      for (let column = 0; column < columns; column++) {
        const cx = startX + column * TILE;
        const cz = startZ + row * TILE;
        if (isClear(cx, cz, buildings)) grass.push({ x: cx, z: cz, y: top, size: TILE });
      }
    }
  }

  // Plant trees on the lawns — fewer per tile if there's more lawn than the tree budget allows.
  const treeChance = Math.min(TREE_CHANCE, MAX_CITY_TREES / Math.max(1, grass.length));
  for (const tile of grass) {
    if (random() >= treeChance) continue;
    trees.push({
      x: tile.x + (random() * 2 - 1) * JITTER,
      z: tile.z + (random() * 2 - 1) * JITTER,
      y: tile.y,
      scale: 0.75 + random() * 0.6,
      tint: random(),
    });
  }

  trees.push(...greenBelt(layout.size, random));
  return { grass, trees };
}

/**
 * Two squares don't overlap if they are apart along x OR along z.
 * The tile (half-size TILE/2) must be apart from every building's footprint by CLEARANCE.
 */
function isClear(cx: number, cz: number, buildings: Building[]): boolean {
  return buildings.every((b) => {
    const minDistance = b.width / 2 + TILE / 2 + CLEARANCE;
    return Math.abs(b.x - cx) >= minDistance || Math.abs(b.z - cz) >= minDistance;
  });
}

/** Trees on the grass in a band just outside the city's edge (the city is a square centred on 0,0). */
function greenBelt(citySize: number, random: () => number): Tree[] {
  const inner = citySize / 2 + 1; // leave a strip of open grass along the city edge
  const outer = inner + Math.min(12, Math.max(3, citySize * 0.08));
  // Space the trees out more on huge cities, so the belt never exceeds MAX_BELT_TREES.
  const bandArea = (2 * outer) ** 2 - (2 * inner) ** 2;
  const spacing = Math.max(1.1, Math.sqrt(bandArea / MAX_BELT_TREES));

  const trees: Tree[] = [];
  for (let x = -outer; x <= outer; x += spacing) {
    for (let z = -outer; z <= outer; z += spacing) {
      if (Math.max(Math.abs(x), Math.abs(z)) < inner) continue; // inside the city
      if (random() > 0.7) continue; // leave some gaps, so it looks planted by nature, not a grid
      trees.push({
        x: x + (random() - 0.5) * spacing * 0.8,
        z: z + (random() - 0.5) * spacing * 0.8,
        y: 0,
        scale: 0.9 + random() * 0.9,
        tint: random(),
      });
    }
  }
  return trees;
}

/** Repeatable pseudo-random numbers in 0..1 (same seed → same sequence). */
function seededRandom(seed: number): () => number {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}
