import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { HistoryData } from "../../shared/types";
import { parseLsTree, readHistory, sampleCommits, type CommitPoint } from "../src/history";

describe("sampleCommits", () => {
  const day = 86_400_000;
  // 10 commits, one per day.
  const commits: CommitPoint[] = Array.from({ length: 10 }, (_, i) => ({ hash: `c${i}`, time: i * day }));

  it("keeps every commit when there are fewer than the points asked for", () => {
    expect(sampleCommits(commits, 20)).toHaveLength(10);
  });

  it("spreads points evenly in time and always includes first and last", () => {
    expect(sampleCommits(commits, 4).map((c) => c.hash)).toEqual(["c0", "c3", "c6", "c9"]);
  });

  it("takes the last commit before each moment, without duplicates", () => {
    // A burst of commits on day 0, then one on day 10.
    const bursty: CommitPoint[] = [
      { hash: "a", time: 0 },
      { hash: "b", time: 1 },
      { hash: "c", time: 2 },
      { hash: "d", time: 10 * day },
    ];
    expect(sampleCommits(bursty, 3).map((c) => c.hash)).toEqual(["a", "c", "d"]);
  });
});

describe("parseLsTree", () => {
  it("reads blobs and skips submodules", () => {
    const output = [
      "100644 blob aaa111     120\tsrc/app.ts",
      "100644 blob bbb222       7\tdocs/read me.md",
      "160000 commit ccc333       -\tvendor/lib",
      "",
    ].join("\0");
    expect(parseLsTree(output)).toEqual([
      { blob: "aaa111", size: 120, path: "src/app.ts" },
      { blob: "bbb222", size: 7, path: "docs/read me.md" },
    ]);
  });
});

describe("readHistory", () => {
  const tempDirs: string[] = [];
  afterEach(() => {
    for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  function commit(dir: string, date: string) {
    execFileSync("git", ["-c", "core.autocrlf=false", "add", "-A"], { cwd: dir });
    const env = { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date };
    execFileSync(
      "git",
      ["-c", "user.name=T", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", "commit", "-q", "-m", date],
      { cwd: dir, env },
    );
  }

  /** LOC per path in one snapshot, for easy checking. */
  function locs(history: HistoryData, index: number): Record<string, number> {
    const snapshot = history.snapshots[index];
    return Object.fromEntries(snapshot.fileIds.map((id, i) => [history.files[id].path, snapshot.loc[i]]));
  }

  it("records files growing, appearing and being deleted", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "codecity-history-"));
    tempDirs.push(dir);
    execFileSync("git", ["init", "-q"], { cwd: dir });
    mkdirSync(path.join(dir, "src"));

    writeFileSync(path.join(dir, "src/a.ts"), "1\n2\n");
    writeFileSync(path.join(dir, "old.py"), "x = 1\n");
    writeFileSync(path.join(dir, "logo.png"), Buffer.from([0x89, 0, 1, 2])); // not a source file
    commit(dir, "2026-01-01T00:00:00Z");

    writeFileSync(path.join(dir, "src/a.ts"), "1\n2\n3\n\n4\n");
    writeFileSync(path.join(dir, "src/b.ts"), "b\n");
    unlinkSync(path.join(dir, "old.py"));
    commit(dir, "2026-02-01T00:00:00Z");

    const history = (await readHistory(dir, 10))!;
    expect(history.snapshots).toHaveLength(2);
    expect(locs(history, 0)).toEqual({ "old.py": 1, "src/a.ts": 2 });
    expect(locs(history, 1)).toEqual({ "src/a.ts": 4, "src/b.ts": 1 });
    // Every file that ever existed is listed once, including the deleted one.
    expect(history.files.map((f) => f.path).sort()).toEqual(["old.py", "src/a.ts", "src/b.ts"]);
    expect(history.snapshots[1].date).toBe("2026-02-01T00:00:00.000Z");
  });

  it("uses paths relative to the scanned sub-folder", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "codecity-history-"));
    tempDirs.push(dir);
    execFileSync("git", ["init", "-q"], { cwd: dir });
    mkdirSync(path.join(dir, "app/src"), { recursive: true });
    writeFileSync(path.join(dir, "app/src/main.ts"), "x\n");
    writeFileSync(path.join(dir, "outside.ts"), "y\n");
    commit(dir, "2026-01-01T00:00:00Z");

    const history = (await readHistory(path.join(dir, "app"), 10))!;
    expect(history.files.map((f) => f.path)).toEqual(["src/main.ts"]);
  });

  it("returns null for a folder that is not a git repo", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "codecity-history-"));
    tempDirs.push(dir);
    expect(await readHistory(dir, 10)).toBeNull();
  });
});
