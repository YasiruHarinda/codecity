import { describe, expect, it } from "vitest";
import type { FileNode } from "../../shared/types";
import { createColorScale, languageColor } from "../src/colors";

function file(name: string, language: string, commits?: number, lastCommitDate?: string): FileNode {
  return {
    type: "file",
    name,
    path: name,
    language,
    loc: 10,
    bytes: 100,
    git:
      commits === undefined
        ? undefined
        : {
            commits,
            authorCount: 1,
            topAuthors: [],
            firstCommitDate: "2025-01-01T00:00:00.000Z",
            lastCommitDate: lastCommitDate ?? "2026-01-01T00:00:00.000Z",
          },
  };
}

/** Hue of a colour, 0..1 (0 = red, ~0.62 = blue). */
const hue = (color: { getHSL: (target: { h: number; s: number; l: number }) => { h: number } }) =>
  color.getHSL({ h: 0, s: 0, l: 0 }).h;

describe("churn colours", () => {
  const files = [file("calm.ts", "TypeScript", 1), file("busy.ts", "TypeScript", 50), file("new.ts", "TypeScript")];
  const scale = createColorScale("churn", files);

  it("makes 1 commit blue and the busiest file red", () => {
    expect(hue(scale.colorFor(files[0]))).toBeCloseTo(0.62, 2);
    expect(hue(scale.colorFor(files[1]))).toBeCloseTo(0, 2);
  });

  it("uses grey for files without git history and says so in the legend", () => {
    expect(scale.colorFor(files[2]).getHexString()).toBe("8a8f98");
    expect(scale.legend).toMatchObject({ kind: "gradient", minLabel: "1", maxLabel: "50", note: expect.any(String) });
  });
});

describe("age colours", () => {
  it("gives the oldest and newest files different ends of the scale", () => {
    const old = file("old.ts", "TypeScript", 1, "2024-01-01T00:00:00.000Z");
    const recent = file("recent.ts", "TypeScript", 1, "2026-06-01T00:00:00.000Z");
    const scale = createColorScale("age", [old, recent]);
    expect(hue(scale.colorFor(old))).toBeCloseTo(0.75, 2);
    expect(hue(scale.colorFor(recent))).toBeCloseTo(0.08, 2);
  });
});

describe("language colours", () => {
  it("uses fixed colours for known languages", () => {
    expect(languageColor("TypeScript").getHexString()).toBe("3178c6");
  });

  it("gives unknown languages a stable colour", () => {
    expect(languageColor("Zig").getHexString()).toBe(languageColor("Zig").getHexString());
  });

  it("lists languages in the legend, most files first", () => {
    const scale = createColorScale("language", [
      file("a.py", "Python"),
      file("b.ts", "TypeScript"),
      file("c.ts", "TypeScript"),
    ]);
    expect(scale.legend).toMatchObject({
      kind: "swatches",
      items: [
        { label: "TypeScript", count: 2 },
        { label: "Python", count: 1 },
      ],
    });
  });
});
