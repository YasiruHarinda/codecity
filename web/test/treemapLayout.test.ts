import { describe, expect, it } from "vitest";
import type { CityData, FileNode, FolderNode } from "../../shared/types";
import { buildingHeight, buildingWidth } from "../src/layout/sizes";
import { treemapLayout } from "../src/layout/treemapLayout";
import type { Building, Rect } from "../src/layout/types";

/** Tiny repeatable random number generator, so the test tree is the same every run. */
function makeRandom(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

/** Builds a random folder tree: a few levels deep, files of very different sizes. */
function randomFolder(path: string, depth: number, random: () => number): FolderNode {
  const children: (FileNode | FolderNode)[] = [];
  const fileCount = 1 + Math.floor(random() * 12);
  for (let i = 0; i < fileCount; i++) {
    const loc = Math.floor(random() ** 3 * 3000);
    const name = `f${i}.ts`;
    children.push({ type: "file", name, path: `${path}/${name}`, language: "TypeScript", loc, bytes: loc * 30 });
  }
  if (depth < 3) {
    const folderCount = Math.floor(random() * 4);
    for (let i = 0; i < folderCount; i++) children.push(randomFolder(`${path}/d${i}`, depth + 1, random));
  }
  return { type: "folder", name: path.split("/").pop()!, path, loc: 0, fileCount: 0, children };
}

function city(root: FolderNode): CityData {
  return { version: 1, repoName: "test", scannedAt: "", fileSource: "git", git: null, root };
}

function countFiles(folder: FolderNode): number {
  return folder.children.reduce((n, c) => n + (c.type === "file" ? 1 : countFiles(c)), 0);
}

function footprintsOverlap(a: Building, b: Building): boolean {
  const reach = (a.width + b.width) / 2 - 1e-9;
  return Math.abs(a.x - b.x) < reach && Math.abs(a.z - b.z) < reach;
}

describe("building size", () => {
  it("is taller for more lines, but log-scaled", () => {
    expect(buildingHeight(100)).toBeGreaterThan(buildingHeight(10));
    expect(buildingHeight(10_000) / buildingHeight(100)).toBeLessThan(2.5);
  });

  it("keeps width between 0.6 and 3", () => {
    expect(buildingWidth(0)).toBeCloseTo(0.6);
    expect(buildingWidth(100_000_000)).toBe(3);
  });
});

describe("treemapLayout", () => {
  const root = randomFolder("root", 0, makeRandom(42));
  const layout = treemapLayout(city(root));

  it("creates one building per file and one district per folder", () => {
    expect(layout.buildings).toHaveLength(countFiles(root));
    expect(layout.districts[0].folder).toBe(root);
    expect(layout.districts[0].level).toBe(0);
  });

  it("never lets two buildings overlap", () => {
    const { buildings } = layout;
    for (let i = 0; i < buildings.length; i++) {
      for (let j = i + 1; j < buildings.length; j++) {
        expect(footprintsOverlap(buildings[i], buildings[j])).toBe(false);
      }
    }
  });

  it("stands every building on its folder's sidewalk lot, inside its folder's district", () => {
    const inside = (b: Building, r: Rect) =>
      b.x - b.width / 2 >= r.x - 1e-9 &&
      b.x + b.width / 2 <= r.x + r.w + 1e-9 &&
      b.z - b.width / 2 >= r.y - 1e-9 &&
      b.z + b.width / 2 <= r.y + r.h + 1e-9;

    for (const building of layout.buildings) {
      const folderPath = building.file.path.slice(0, building.file.path.lastIndexOf("/"));
      const district = layout.districts.find((d) => d.folder.path === folderPath)!;
      const lot = layout.lots.find((l) => l.folder.path === folderPath)!;
      expect(inside(building, district.rect)).toBe(true);
      expect(inside(building, lot.rect)).toBe(true);
      expect(lot.baseY).toBeCloseTo(district.baseY + district.thickness); // lot sits on the district
      expect(building.baseY).toBeCloseTo(lot.baseY + lot.thickness); // building sits on the lot
    }
  });

  it("runs road centre lines between blocks, never through one", () => {
    expect(layout.roads.length).toBeGreaterThan(0);
    // Blocks standing on the ground at some height: lots, and every district except the root.
    const blocks = [
      ...layout.lots.map((l) => ({ rect: l.rect, standsAt: l.baseY })),
      ...layout.districts.filter((d) => d.level > 0).map((d) => ({ rect: d.rect, standsAt: d.baseY })),
    ];
    for (const road of layout.roads) {
      expect(road.x1 === road.x2 || road.z1 === road.z2).toBe(true); // straight along x or z
      const midX = (road.x1 + road.x2) / 2;
      const midZ = (road.z1 + road.z2) / 2;
      // A road painted at height y must not run through a block standing at that same height.
      for (const { rect, standsAt } of blocks) {
        if (Math.abs(standsAt - road.y) > 1e-9) continue;
        const through =
          midX > rect.x + 1e-6 && midX < rect.x + rect.w - 1e-6 && midZ > rect.y + 1e-6 && midZ < rect.y + rect.h - 1e-6;
        expect(through).toBe(false);
      }
    }
  });

  it("nests sub-districts inside their parent and raises them one level", () => {
    for (const child of layout.districts) {
      if (child.level === 0) continue;
      const parentPath = child.folder.path.slice(0, child.folder.path.lastIndexOf("/"));
      const parent = layout.districts.find((d) => d.folder.path === parentPath)!;
      expect(child.level).toBe(parent.level + 1);
      expect(child.baseY).toBeCloseTo(parent.baseY + parent.thickness);
      expect(child.rect.x).toBeGreaterThanOrEqual(parent.rect.x);
      expect(child.rect.x + child.rect.w).toBeLessThanOrEqual(parent.rect.x + parent.rect.w + 1e-9);
    }
  });

  it("centres the city on (0, 0)", () => {
    const root = layout.districts[0].rect;
    expect(root.x + root.w / 2).toBeCloseTo(0);
    expect(root.y + root.h / 2).toBeCloseTo(0);
  });

  it("never drops or squashes files in a tiny folder next to a huge one", () => {
    // The case that used to fail: a one-file folder beside a big folder got a strip
    // thinner than its own border, leaving no room for its file.
    const big = randomFolder("r/big", 1, makeRandom(7));
    const tinyFile: FileNode = { type: "file", name: "x.sql", path: "r/tiny/x.sql", language: "SQL", loc: 20, bytes: 800 };
    const tiny: FolderNode = { type: "folder", name: "tiny", path: "r/tiny", loc: 20, fileCount: 1, children: [tinyFile] };
    const readme: FileNode = { type: "file", name: "README.md", path: "r/README.md", language: "Markdown", loc: 50, bytes: 3000 };
    const root: FolderNode = { type: "folder", name: "r", path: "r", loc: 0, fileCount: 0, children: [big, tiny, readme] };

    const result = treemapLayout(city(root));
    expect(result.buildings).toHaveLength(countFiles(root));
    for (const building of result.buildings) {
      expect(building.width).toBeGreaterThan(0.5 * buildingWidth(building.file.bytes));
    }
  });

  it("handles a repo with no files", () => {
    const empty = treemapLayout(city({ type: "folder", name: "e", path: "", loc: 0, fileCount: 0, children: [] }));
    expect(empty.buildings).toEqual([]);
    expect(empty.districts).toHaveLength(1);
  });
});
