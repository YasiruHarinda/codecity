import type { CityData, FileNode, FolderNode } from "../../../shared/types";
import { buildingHeight, buildingWidth } from "./sizes";
import { squarify } from "./squarify";
import type { CityLayout, Rect } from "./types";

/** How much each nested district is raised above its parent. */
const PLATFORM_THICKNESS = 0.25;
/** Height of the sidewalk slab the buildings stand on. */
const LOT_THICKNESS = 0.12;
/** Every street is this wide. Neighbouring blocks each give up half of it. */
export const ROAD_WIDTH = 0.9;
const ROAD_HALF = ROAD_WIDTH / 2;
/**
 * Border inside each district. Together with the half road around each block inside,
 * it makes a ring road exactly as wide as the streets between blocks.
 */
const PADDING = ROAD_HALF;
/** Extra space along the front edge of each district for its name. */
const LABEL_STRIP = 1.4;
/** Space around each building inside its plot (sidewalk between buildings). */
const PLOT_GAP = 0.6;
const MIN_BUILDING_WIDTH = 0.2;
/** Districts narrower than this don't get a label (the text would be unreadable). */
const MIN_LABEL_WIDTH = 3;
/**
 * Anti-sliver rule, see `measureFolder`. Even if an item ends up in a strip running along the
 * whole parent, that strip will be at least this fraction of the item's natural width.
 */
const MIN_STRIP_SHARE = 0.4;

/**
 * A folder's own files, grouped into one block ("lot") before the folder is treemapped.
 * This way many small files next to one big sub-folder are laid out together,
 * instead of each file being squeezed into its own thin leftover strip.
 */
interface Lot {
  type: "lot";
  files: FileNode[];
}

/** Things the treemap splits a district between. */
type Block = FolderNode | Lot;

/**
 * Lays out the city as a nested squarified treemap:
 * every folder is a district, every file a building inside its folder's district.
 *
 * Streets come for free: treemap cells touch edge to edge, so shrinking every cell by half a road
 * width opens a full-width street between neighbours — with the old shared edge as its centre line.
 */
export function treemapLayout(city: CityData): CityLayout {
  // Pass 1 (bottom-up): how much ground does every folder and lot get?
  const weights = new Map<Block | FileNode, number>();
  const lots = new Map<FolderNode, Lot>();
  const rootArea = measureFolder(city.root, weights, lots);

  // Pass 2 (top-down): split the ground between children, level by level.
  const size = Math.sqrt(rootArea);
  const layout: CityLayout = { buildings: [], districts: [], lots: [], roads: [], size };
  layoutFolder(city.root, { x: 0, y: 0, w: size, h: size }, 0, weights, lots, layout);

  // The treemap starts at (0, 0) in a corner; move it so the city is centred on (0, 0).
  const shift = size / 2;
  for (const building of layout.buildings) {
    building.x -= shift;
    building.z -= shift;
  }
  for (const item of [...layout.districts, ...layout.lots]) {
    item.rect.x -= shift;
    item.rect.y -= shift;
  }
  for (const district of layout.districts) {
    if (district.label) {
      district.label.x -= shift;
      district.label.y -= shift;
    }
  }
  for (const road of layout.roads) {
    road.x1 -= shift;
    road.x2 -= shift;
    road.z1 -= shift;
    road.z2 -= shift;
  }

  return layout;
}

/** A file needs a square plot: building width plus a gap around it. */
function plotArea(file: FileNode): number {
  const side = buildingWidth(file.bytes) + PLOT_GAP;
  return side * side;
}

/** Adds half a road on every side of a (roughly square) block of this area. */
function withRoads(area: number): number {
  const side = Math.sqrt(area) + ROAD_WIDTH;
  return side * side;
}

/**
 * Works out (bottom-up) how much ground a folder needs, and the weight of each block inside it.
 * Every block (sub-folder or lot) also needs the streets around it, so those are added first —
 * otherwise the roads would eat into the buildings' space.
 *
 * Anti-sliver rule: a squarified treemap keeps areas exact, so an item that is tiny next to a
 * huge sibling can end up as a long thin strip. To avoid that, each block gets at least
 *   MIN_STRIP_SHARE × (its natural width) × (the folder's width)
 * of area, so even a strip along the folder's full width is thick enough to hold it.
 * The extra ground just shows up as a little empty space around it.
 */
function measureFolder(
  folder: FolderNode,
  weights: Map<Block | FileNode, number>,
  lots: Map<FolderNode, Lot>,
): number {
  const blocks: Block[] = [];
  for (const child of folder.children) {
    if (child.type === "folder") {
      weights.set(child, withRoads(measureFolder(child, weights, lots)));
      blocks.push(child);
    }
  }

  const files = folder.children.filter((child): child is FileNode => child.type === "file");
  if (files.length > 0) {
    const lot: Lot = { type: "lot", files };
    for (const file of files) weights.set(file, plotArea(file));
    weights.set(lot, withRoads(files.reduce((sum, file) => sum + plotArea(file), 0)));
    lots.set(folder, lot);
    blocks.push(lot);
  }

  const naturalTotal = blocks.reduce((sum, block) => sum + weights.get(block)!, 0);
  const folderWidth = Math.sqrt(naturalTotal);
  let innerArea = 0;
  for (const block of blocks) {
    const natural = weights.get(block)!;
    const weight = Math.max(natural, MIN_STRIP_SHARE * Math.sqrt(natural) * folderWidth);
    weights.set(block, weight);
    innerArea += weight;
  }

  // Treemap cells come out roughly square, so pretend the children fill a square and add the border.
  const side = Math.sqrt(innerArea);
  return (side + 2 * PADDING) * (side + 2 * PADDING + LABEL_STRIP);
}

/**
 * Shrinks a rect on every side — but by at most 10% of its short side, so small or thin blocks get
 * a narrow alley instead of a full street (a full street would squeeze their buildings into needles).
 */
function inset(rect: Rect, amount: number): Rect {
  const d = Math.min(amount, Math.min(rect.w, rect.h) * 0.1);
  return { x: rect.x + d, y: rect.y + d, w: rect.w - 2 * d, h: rect.h - 2 * d };
}

/** @param rect the district's block — already shrunk to leave room for the streets around it */
function layoutFolder(
  folder: FolderNode,
  rect: Rect,
  level: number,
  weights: Map<Block | FileNode, number>,
  lots: Map<FolderNode, Lot>,
  layout: CityLayout,
): void {
  const baseY = level * PLATFORM_THICKNESS;
  const topY = baseY + PLATFORM_THICKNESS;

  // Small districts get a thinner border, so there is always room left inside (never negative).
  const padding = Math.min(PADDING, Math.min(rect.w, rect.h) * 0.1);
  const innerW = rect.w - 2 * padding;
  // The label strip sits along the front edge (largest y, which is +z in 3D — nearest the camera).
  // It's only added if the district is big enough to still have room for its contents.
  const hasLabel = innerW >= MIN_LABEL_WIDTH && rect.h - 2 * padding >= LABEL_STRIP * 2;
  const labelStrip = hasLabel ? LABEL_STRIP : 0;
  const label = hasLabel
    ? { x: rect.x + padding, y: rect.y + rect.h - padding - LABEL_STRIP, w: innerW, h: LABEL_STRIP }
    : null;
  layout.districts.push({ folder, level, rect, baseY, thickness: PLATFORM_THICKNESS, label });

  // Children go inside the border, above the label strip.
  const inner: Rect = { x: rect.x + padding, y: rect.y + padding, w: innerW, h: rect.h - 2 * padding - labelStrip };

  const blocks: Block[] = folder.children.filter((child): child is FolderNode => child.type === "folder");
  const lot = lots.get(folder);
  if (lot) blocks.push(lot);

  const cells = squarify(
    blocks.map((block) => ({ item: block, weight: weights.get(block)! })),
    inner,
  );

  addRoadLines(
    inner,
    cells.map((cell) => cell.rect),
    topY,
    layout,
  );

  for (const { item: block, rect: cell } of cells) {
    // Each block gives up half a road on every side; its neighbour gives up the other half.
    const blockRect = inset(cell, ROAD_HALF);
    if (block.type === "folder") {
      layoutFolder(block, blockRect, level + 1, weights, lots, layout);
    } else {
      layoutLot(folder, block, blockRect, topY, weights, layout);
    }
  }
}

/**
 * Road centre lines inside one district: the ring road around its cells (the edge of `inner`)
 * and every edge two cells share. Only right and bottom edges are taken from each cell, so a
 * shared edge is drawn once (its neighbour's left/top edge is the same line).
 */
function addRoadLines(inner: Rect, cells: Rect[], y: number, layout: CityLayout): void {
  if (cells.length === 0) return;
  const e = 1e-6;
  const line = (x1: number, z1: number, x2: number, z2: number) => layout.roads.push({ x1, z1, x2, z2, y });
  const right = inner.x + inner.w;
  const bottom = inner.y + inner.h;

  line(inner.x, inner.y, right, inner.y);
  line(inner.x, bottom, right, bottom);
  line(inner.x, inner.y, inner.x, bottom);
  line(right, inner.y, right, bottom);

  for (const cell of cells) {
    if (cell.x + cell.w < right - e) line(cell.x + cell.w, cell.y, cell.x + cell.w, cell.y + cell.h);
    if (cell.y + cell.h < bottom - e) line(cell.x, cell.y + cell.h, cell.x + cell.w, cell.y + cell.h);
  }
}

/** Puts a folder's own files on a sidewalk slab, one building in the middle of each plot. */
function layoutLot(
  folder: FolderNode,
  lot: Lot,
  rect: Rect,
  groundY: number,
  weights: Map<Block | FileNode, number>,
  layout: CityLayout,
): void {
  layout.lots.push({ folder, rect, baseY: groundY, thickness: LOT_THICKNESS });

  const plots = squarify(
    lot.files.map((file) => ({ item: file, weight: weights.get(file)! })),
    rect,
  );

  for (const { item: file, rect: plot } of plots) {
    // Shrink the building if the plot came out smaller than planned; the gap shrinks too
    // (to at most a quarter of the plot), so small plots don't turn into needles.
    const plotSide = Math.min(plot.w, plot.h);
    const room = plotSide - Math.min(PLOT_GAP, plotSide * 0.25);
    layout.buildings.push({
      file,
      x: plot.x + plot.w / 2,
      z: plot.y + plot.h / 2,
      baseY: groundY + LOT_THICKNESS,
      width: Math.max(MIN_BUILDING_WIDTH, Math.min(buildingWidth(file.bytes), room)),
      height: buildingHeight(file.loc),
    });
  }
}
