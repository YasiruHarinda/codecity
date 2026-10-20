import type { Rect } from "./types";

export interface WeightedItem<T> {
  item: T;
  weight: number;
}

export interface PlacedItem<T> {
  item: T;
  rect: Rect;
}

/**
 * Squarified treemap (Bruls, Huizing & van Wijk, 2000).
 *
 * Splits `bounds` into one rectangle per item, with area proportional to its weight,
 * keeping each rectangle as close to a square as possible.
 *
 *   1. Sort items biggest first.
 *   2. Build a "row" along the shorter side of the free space.
 *   3. Keep adding items to the row while that makes its worst aspect ratio better.
 *   4. When it would get worse, freeze the row (it takes a strip of the free space)
 *      and start a new row in the space that's left.
 *
 * Items with weight 0 are left out.
 */
export function squarify<T>(items: WeightedItem<T>[], bounds: Rect): PlacedItem<T>[] {
  const sorted = items.filter((entry) => entry.weight > 0).sort((a, b) => b.weight - a.weight);
  const totalWeight = sorted.reduce((sum, entry) => sum + entry.weight, 0);
  if (totalWeight === 0 || bounds.w <= 0 || bounds.h <= 0) return [];

  // Convert weights to actual areas, so all items together fill `bounds` exactly.
  const scale = (bounds.w * bounds.h) / totalWeight;
  const entries = sorted.map((entry) => ({ item: entry.item, area: entry.weight * scale }));

  const placed: PlacedItem<T>[] = [];
  let free: Rect = { ...bounds };
  let row: Entry<T>[] = [];
  // Running totals for the current row, so we don't re-add it up every time.
  let rowArea = 0;
  let rowMin = Infinity;
  let rowMax = 0;

  for (const entry of entries) {
    const side = Math.min(free.w, free.h);
    const withEntry = worstAspectRatio(
      rowArea + entry.area,
      Math.min(rowMin, entry.area),
      Math.max(rowMax, entry.area),
      side,
    );

    if (row.length === 0 || withEntry <= worstAspectRatio(rowArea, rowMin, rowMax, side)) {
      // Adding it keeps the row at least as square — keep growing the row.
      row.push(entry);
      rowArea += entry.area;
      rowMin = Math.min(rowMin, entry.area);
      rowMax = Math.max(rowMax, entry.area);
    } else {
      // It would make things worse: freeze the row and start a new one with this item.
      free = placeRow(row, rowArea, free, placed);
      row = [entry];
      rowArea = rowMin = rowMax = entry.area;
    }
  }

  if (row.length > 0) placeRow(row, rowArea, free, placed);
  return placed;
}

interface Entry<T> {
  item: T;
  area: number;
}

/**
 * The worst (largest) aspect ratio of any rectangle in a row laid along a side of length `side`.
 * 1 = perfect square; bigger = thinner. From the paper:
 *   max( side² · maxArea / rowArea²,  rowArea² / (side² · minArea) )
 */
function worstAspectRatio(rowArea: number, minArea: number, maxArea: number, side: number): number {
  const side2 = side * side;
  const area2 = rowArea * rowArea;
  return Math.max((side2 * maxArea) / area2, area2 / (side2 * minArea));
}

/**
 * Places a finished row as a strip along the shorter side of the free space.
 * Returns the free space that is left after the strip is taken.
 */
function placeRow<T>(row: Entry<T>[], rowArea: number, free: Rect, placed: PlacedItem<T>[]): Rect {
  if (free.w >= free.h) {
    // Free space is wide: the row becomes a column on the left, as tall as the free space.
    const thickness = rowArea / free.h;
    let y = free.y;
    for (const entry of row) {
      const h = entry.area / thickness;
      placed.push({ item: entry.item, rect: { x: free.x, y, w: thickness, h } });
      y += h;
    }
    return { x: free.x + thickness, y: free.y, w: Math.max(0, free.w - thickness), h: free.h };
  }

  // Free space is tall: the row becomes a strip along the top, as wide as the free space.
  const thickness = rowArea / free.w;
  let x = free.x;
  for (const entry of row) {
    const w = entry.area / thickness;
    placed.push({ item: entry.item, rect: { x, y: free.y, w, h: thickness } });
    x += w;
  }
  return { x: free.x, y: free.y + thickness, w: free.w, h: Math.max(0, free.h - thickness) };
}
