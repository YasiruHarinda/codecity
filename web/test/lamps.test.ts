import { describe, expect, it } from "vitest";
import type { CityData, FileNode, FolderNode } from "../../shared/types";
import { placeLamps } from "../src/layout/lamps";
import { treemapLayout } from "../src/layout/treemapLayout";

function file(path: string, loc: number, bytes: number): FileNode {
  return { type: "file", name: path.split("/").pop()!, path, language: "TypeScript", loc, bytes };
}

function folder(path: string, children: (FileNode | FolderNode)[]): FolderNode {
  return { type: "folder", name: path.split("/").pop() ?? "", path, loc: 0, fileCount: 0, children };
}

function city(root: FolderNode): CityData {
  return { version: 1, repoName: "r", scannedAt: "", fileSource: "git", git: null, root };
}

const layout = treemapLayout(
  city(
    folder("", [
      folder("src", Array.from({ length: 30 }, (_, i) => file(`src/f${i}.ts`, 100 + i * 30, 3000 + i * 200))),
      folder("docs", [file("docs/a.md", 40, 1200), file("docs/b.md", 80, 2400)]),
      file("README.md", 30, 900),
    ]),
  ),
);
const lamps = placeLamps(layout);

describe("placeLamps", () => {
  it("puts lamps around the sidewalk slabs", () => {
    expect(lamps.length).toBeGreaterThan(0);
  });

  it("stands every lamp on the road just outside a slab — never on one", () => {
    for (const lamp of lamps) {
      const onSlab = layout.lots.some(
        (lot) =>
          lamp.x > lot.rect.x && lamp.x < lot.rect.x + lot.rect.w && lamp.z > lot.rect.y && lamp.z < lot.rect.y + lot.rect.h,
      );
      expect(onSlab).toBe(false);

      // ...but right next to the slab it belongs to (at the same height).
      const nextToSlab = layout.lots.some((lot) => {
        if (Math.abs(lot.baseY - lamp.y) > 1e-9) return false;
        const dx = Math.max(lot.rect.x - lamp.x, 0, lamp.x - (lot.rect.x + lot.rect.w));
        const dz = Math.max(lot.rect.y - lamp.z, 0, lamp.z - (lot.rect.y + lot.rect.h));
        return Math.hypot(dx, dz) < 0.1;
      });
      expect(nextToSlab).toBe(true);
    }
  });

  it("spaces lamps out on huge cities to stay within the budget", () => {
    const huge = treemapLayout(
      city(folder("", Array.from({ length: 400 }, (_, f) => folder(`d${f}`, Array.from({ length: 25 }, (_, i) => file(`d${f}/f${i}.ts`, 50, 1000)))))),
    );
    expect(placeLamps(huge).length).toBeLessThanOrEqual(8000);
  });
});
