import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { listFiles } from "../src/walk";

const tempDirs: string[] = [];

/** Creates a temp folder with the given files (path → content). */
function makeProject(files: Record<string, string>): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "codecity-test-"));
  tempDirs.push(dir);
  for (const [filePath, content] of Object.entries(files)) {
    const fullPath = path.join(dir, filePath);
    mkdirSync(path.dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, content);
  }
  return dir;
}

const projectFiles = {
  ".gitignore": "secret.ts\nlogs/\n",
  "src/app.ts": "x",
  "src/util/helper.ts": "x",
  "secret.ts": "x",
  "logs/today.ts": "x",
  "node_modules/lib/index.js": "x",
  "bin/Debug/out.cs": "x",
};

const expected = [".gitignore", "src/app.ts", "src/util/helper.ts"];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("listFiles", () => {
  it("walks the disk when the folder is not a git repo", async () => {
    const dir = makeProject(projectFiles);
    const result = await listFiles(dir);
    expect(result.source).toBe("filesystem");
    expect(result.files).toEqual(expected);
  });

  it("uses git when the folder is a git repo", async () => {
    const dir = makeProject(projectFiles);
    execFileSync("git", ["init", "-q"], { cwd: dir });
    const result = await listFiles(dir);
    expect(result.source).toBe("git");
    expect(result.files).toEqual(expected);
  });
});
