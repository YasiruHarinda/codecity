import { describe, expect, it } from "vitest";
import type { CityData, FileNode } from "../../shared/types";
import { buildDependencyIndex, NO_DEPENDENCIES } from "../src/dependencies";

function file(path: string, imports?: string[]): FileNode {
  return { type: "file", name: path, path, language: "TypeScript", loc: 1, bytes: 1, imports };
}

const city: CityData = {
  version: 1,
  repoName: "test",
  scannedAt: "",
  fileSource: "git",
  git: null,
  // a → b → c → b (b and c form a cycle), d → a, e has no imports info
  cycles: [["b", "c"]],
  root: {
    type: "folder",
    name: "test",
    path: "",
    loc: 0,
    fileCount: 5,
    children: [file("a", ["b"]), file("b", ["c"]), file("c", ["b"]), file("d", ["a"]), file("e")],
  },
};

describe("buildDependencyIndex", () => {
  const index = buildDependencyIndex(city);

  it("lists every edge", () => {
    expect(index.edges).toEqual([
      ["a", "b"],
      ["b", "c"],
      ["c", "b"],
      ["d", "a"],
    ]);
  });

  it("answers imports and imported-by in both directions", () => {
    expect(index.importsOf("a")).toEqual(["b"]);
    expect(index.importersOf("a")).toEqual(["d"]);
    expect(index.importersOf("b")).toEqual(["a", "c"]);
    expect(index.importsOf("e")).toEqual([]);
  });

  it("marks only edges inside a cycle as cycle edges", () => {
    expect(index.isCycleEdge("b", "c")).toBe(true);
    expect(index.isCycleEdge("c", "b")).toBe(true);
    expect(index.isCycleEdge("a", "b")).toBe(false); // a points INTO the cycle but isn't part of it
    expect(index.cycleOf("c")).toEqual(["b", "c"]);
    expect(index.cycleOf("a")).toBeUndefined();
    expect(index.cycleCount).toBe(1);
  });

  it("works for city files from before dependencies existed", () => {
    expect(NO_DEPENDENCIES.edges).toEqual([]);
    expect(NO_DEPENDENCIES.cycleCount).toBe(0);
  });
});
