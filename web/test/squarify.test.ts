import { describe, expect, it } from "vitest";
import { squarify } from "../src/layout/squarify";
import type { Rect } from "../src/layout/types";

const area = (r: Rect) => r.w * r.h;
const aspect = (r: Rect) => Math.max(r.w / r.h, r.h / r.w);

function overlaps(a: Rect, b: Rect): boolean {
  const e = 1e-9; // ignore floating-point touching edges
  return a.x < b.x + b.w - e && b.x < a.x + a.w - e && a.y < b.y + b.h - e && b.y < a.y + a.h - e;
}

describe("squarify", () => {
  // The example from the original paper: weights 6,6,4,3,2,2,1 in a 6×4 rectangle.
  const bounds = { x: 0, y: 0, w: 6, h: 4 };
  const weights = [6, 6, 4, 3, 2, 2, 1];
  const placed = squarify(
    weights.map((weight, index) => ({ item: index, weight })),
    bounds,
  );

  it("places every item", () => {
    expect(placed.map((p) => p.item).sort()).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it("gives each item an area equal to its weight (total weight = total area here)", () => {
    for (const { item, rect } of placed) expect(area(rect)).toBeCloseTo(weights[item]);
  });

  it("keeps every rectangle inside the bounds", () => {
    for (const { rect } of placed) {
      expect(rect.x).toBeGreaterThanOrEqual(-1e-9);
      expect(rect.y).toBeGreaterThanOrEqual(-1e-9);
      expect(rect.x + rect.w).toBeLessThanOrEqual(6 + 1e-9);
      expect(rect.y + rect.h).toBeLessThanOrEqual(4 + 1e-9);
    }
  });

  it("never overlaps", () => {
    for (const a of placed) for (const b of placed) if (a !== b) expect(overlaps(a.rect, b.rect)).toBe(false);
  });

  it("keeps rectangles close to square (the paper gets a worst ratio under 3)", () => {
    expect(Math.max(...placed.map((p) => aspect(p.rect)))).toBeLessThan(3);
  });

  it("scales weights to fill any rectangle", () => {
    const result = squarify(
      [
        { item: "a", weight: 1 },
        { item: "b", weight: 3 },
      ],
      { x: 10, y: 10, w: 8, h: 8 },
    );
    const total = result.reduce((sum, p) => sum + area(p.rect), 0);
    expect(total).toBeCloseTo(64);
    expect(area(result.find((p) => p.item === "b")!.rect)).toBeCloseTo(48);
  });

  it("skips zero weights and handles empty input", () => {
    expect(squarify([], bounds)).toEqual([]);
    expect(squarify([{ item: "x", weight: 0 }], bounds)).toEqual([]);
  });
});
