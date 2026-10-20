import { describe, expect, it } from "vitest";
import type { FileNode, FolderNode } from "../../shared/types";
import { buildTree } from "../src/tree";

function file(filePath: string, loc: number): FileNode {
  const name = filePath.split("/").pop()!;
  return { type: "file", name, path: filePath, language: "TypeScript", loc, bytes: loc * 10 };
}

describe("buildTree", () => {
  const root = buildTree(
    [file("src/lib/b.ts", 20), file("src/a.ts", 10), file("README.md", 5), file("src/lib/c.ts", 1)],
    "myrepo",
  );

  it("creates the root folder", () => {
    expect(root.name).toBe("myrepo");
    expect(root.path).toBe("");
  });

  it("nests files inside their folders", () => {
    const src = root.children[0] as FolderNode;
    expect(src.path).toBe("src");
    const lib = src.children[0] as FolderNode;
    expect(lib.path).toBe("src/lib");
    expect(lib.children.map((c) => c.name)).toEqual(["b.ts", "c.ts"]);
  });

  it("adds up loc and fileCount for every folder", () => {
    expect(root.loc).toBe(36);
    expect(root.fileCount).toBe(4);
    const src = root.children[0] as FolderNode;
    expect(src.loc).toBe(31);
    expect(src.fileCount).toBe(3);
  });

  it("puts folders before files", () => {
    expect(root.children.map((c) => c.name)).toEqual(["src", "README.md"]);
  });

  it("handles an empty file list", () => {
    const empty = buildTree([], "empty");
    expect(empty.children).toEqual([]);
    expect(empty.loc).toBe(0);
  });
});
