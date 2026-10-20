import { describe, expect, it } from "vitest";
import type { CityData, FileNode, FolderNode } from "../../shared/types";
import { placeParks } from "../src/layout/parks";
import { treemapLayout } from "../src/layout/treemapLayout";

function file(path: string, loc: number, bytes: number): FileNode {
  return { type: "file", name: path.split("/").pop()!, path, language: "TypeScript", loc, bytes };
}

function folder(path: string, children: (FileNode | FolderNode)[]): FolderNode {
  return { type: "folder", name: path.split("/").pop() ?? "", path, loc: 0, fileCount: 0, children };
}

// One big folder next to small ones — the anti-sliver rule leaves spare ground, which becomes park.
const city: CityData = {
  version: 1,
  repoName: "r",
  scannedAt: "",
  fileSource: "git",
  git: null,
  root: folder("", [
    folder("big", Array.from({ length: 40 }, (_, i) => file(`big/f${i}.ts`, 50 + i * 20, 2000 + i * 300))),
    folder("tiny", [file("tiny/a.ts", 10, 300)]),
    file("README.md", 30, 900),
  ]),
};
const layout = treemapLayout(city);
const parks = placeParks(layout);

describe("placeParks", () => {
  it("finds some free space for grass and trees", () => {
    expect(parks.grass.length).toBeGreaterThan(0);
    expect(parks.trees.length).toBeGreaterThan(0);
  });

  it("never puts grass under (or touching) a building", () => {
    for (const tile of parks.grass) {
      for (const b of layout.buildings) {
        const apartX = Math.abs(b.x - tile.x) >= b.width / 2 + tile.size / 2;
        const apartZ = Math.abs(b.z - tile.z) >= b.width / 2 + tile.size / 2;
        // Only buildings on the same slab can collide (same height).
        if (Math.abs(b.baseY - tile.y) < 1e-9) expect(apartX || apartZ).toBe(true);
      }
    }
  });

  it("keeps every grass tile on a sidewalk slab", () => {
    for (const tile of parks.grass) {
      const onSomeLot = layout.lots.some(
        (lot) =>
          Math.abs(lot.baseY + lot.thickness - tile.y) < 1e-9 &&
          tile.x - tile.size / 2 >= lot.rect.x - 1e-9 &&
          tile.x + tile.size / 2 <= lot.rect.x + lot.rect.w + 1e-9 &&
          tile.z - tile.size / 2 >= lot.rect.y - 1e-9 &&
          tile.z + tile.size / 2 <= lot.rect.y + lot.rect.h + 1e-9,
      );
      expect(onSomeLot).toBe(true);
    }
  });

  it("plants a belt of trees outside the city", () => {
    const half = layout.size / 2;
    const outside = parks.trees.filter((t) => Math.max(Math.abs(t.x), Math.abs(t.z)) > half);
    expect(outside.length).toBeGreaterThan(0);
    for (const tree of outside) expect(tree.y).toBe(0); // on the ground, not on a slab
  });

  it("never plants more trees inside the city than the budget, however much free space there is", () => {
    // A city of many tiny files in one folder, next to one huge folder: lots of spare lawn.
    const huge: CityData = {
      ...city,
      root: folder("", [
        folder("a", Array.from({ length: 3000 }, (_, i) => file(`a/f${i}.ts`, 10, 100))),
        folder("b", [file("b/x.ts", 10, 100)]),
      ]),
    };
    const hugeLayout = treemapLayout(huge);
    const inCity = placeParks(hugeLayout).trees.filter((t) => t.y > 0);
    expect(inCity.length).toBeLessThanOrEqual(12000 * 1.05); // random draws can go a little over
  });

  it("gives the same city the same parks every time", () => {
    expect(placeParks(layout)).toEqual(parks);
  });
});
