import { describe, expect, it } from "vitest";
import type { FileNode } from "../../shared/types";
import { searchFiles } from "../src/ui/search";

function file(path: string): FileNode {
  return { type: "file", name: path.split("/").pop()!, path, language: "TypeScript", loc: 1, bytes: 1 };
}

const files = [
  file("src/deep/nested/main.ts"),
  file("src/main.ts"),
  file("src/domain.ts"),
  file("tests/app.test.ts"),
  file("main/readme.md"),
];

const search = (query: string, limit?: number) => searchFiles(files, query, limit).map((f) => f.path);

describe("searchFiles", () => {
  it("ranks exact name, then starts-with, then contains, then path", () => {
    expect(search("main.ts")).toEqual(["src/main.ts", "src/deep/nested/main.ts", "src/domain.ts"]);
    expect(search("main")).toEqual(["src/main.ts", "src/deep/nested/main.ts", "src/domain.ts", "main/readme.md"]);
  });

  it("is case-insensitive and trims spaces", () => {
    expect(search("  APP.TEST ")).toEqual(["tests/app.test.ts"]);
  });

  it("returns nothing for an empty query and respects the limit", () => {
    expect(search("")).toEqual([]);
    expect(search("ts", 2)).toHaveLength(2);
  });
});
