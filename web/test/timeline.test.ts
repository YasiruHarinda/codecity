import { describe, expect, it } from "vitest";
import type { CityData, FileNode, FolderNode } from "../../shared/types";
import { Timeline, withDeletedFiles } from "../src/timeline";
import { collectFiles } from "../src/tree";

function file(path: string, loc: number): FileNode {
  return { type: "file", name: path.split("/").pop()!, path, language: "TypeScript", loc, bytes: 100 };
}

// Today: src/a.ts (30 LOC), src/b.ts (5 LOC).
// History: Jan — a.ts (10) and old/legacy.py (50); Feb — a.ts (20), b.ts (5).
const city: CityData = {
  version: 1,
  repoName: "repo",
  scannedAt: "",
  fileSource: "git",
  git: null,
  root: {
    type: "folder",
    name: "repo",
    path: "",
    loc: 35,
    fileCount: 2,
    children: [
      { type: "folder", name: "src", path: "src", loc: 35, fileCount: 2, children: [file("src/a.ts", 30), file("src/b.ts", 5)] },
    ],
  },
  history: {
    files: [
      { path: "src/a.ts", language: "TypeScript", bytes: 300 },
      { path: "old/legacy.py", language: "Python", bytes: 900 },
      { path: "src/b.ts", language: "TypeScript", bytes: 50 },
    ],
    snapshots: [
      { commit: "c1", date: "2026-01-15T00:00:00.000Z", fileIds: [0, 1], loc: [10, 50] },
      { commit: "c2", date: "2026-02-15T00:00:00.000Z", fileIds: [0, 2], loc: [20, 5] },
    ],
  },
};

describe("Timeline", () => {
  const timeline = new Timeline(city, city.history!);

  it("has one frame per snapshot plus 'now'", () => {
    expect(timeline.frames.map((f) => f.commit)).toEqual(["c1", "c2", null]);
    expect(timeline.nowIndex).toBe(2);
    expect(timeline.frames[2].label).toBe("Now");
  });

  it("knows each file's size at each moment", () => {
    expect([0, 1, 2].map((frame) => timeline.locAt(frame, "src/a.ts"))).toEqual([10, 20, 30]);
  });

  it("returns null when a file didn't exist (yet, or any more)", () => {
    expect(timeline.locAt(0, "src/b.ts")).toBeNull(); // not created yet
    expect(timeline.locAt(0, "old/legacy.py")).toBe(50);
    expect(timeline.locAt(1, "old/legacy.py")).toBeNull(); // deleted
    expect(timeline.locAt(2, "old/legacy.py")).toBeNull();
  });
});

describe("withDeletedFiles", () => {
  const { layoutCity, deleted } = withDeletedFiles(city);

  it("adds deleted files as ghosts in their old folders", () => {
    expect([...deleted]).toEqual(["old/legacy.py"]);
    expect(collectFiles(layoutCity.root).map((f) => f.path).sort()).toEqual(["old/legacy.py", "src/a.ts", "src/b.ts"]);
    const oldFolder = layoutCity.root.children.find((c) => c.name === "old") as FolderNode;
    expect(oldFolder.path).toBe("old");
  });

  it("does not change the original city", () => {
    expect(collectFiles(city.root)).toHaveLength(2);
  });

  it("returns the city unchanged when there is no history", () => {
    const plain = { ...city, history: undefined };
    expect(withDeletedFiles(plain).layoutCity).toBe(plain);
  });
});
