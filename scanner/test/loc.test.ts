import { describe, expect, it } from "vitest";
import { countLoc, isBinary } from "../src/loc";

describe("countLoc", () => {
  it("counts non-blank lines", () => {
    expect(countLoc("a\nb\nc")).toBe(3);
  });

  it("ignores empty and whitespace-only lines", () => {
    expect(countLoc("a\n\n   \n\t\nb\n")).toBe(2);
  });

  it("handles Windows and old-Mac line endings", () => {
    expect(countLoc("a\r\n\r\nb\r\nc")).toBe(3);
    expect(countLoc("a\rb\r\rc")).toBe(3);
  });

  it("returns 0 for an empty file", () => {
    expect(countLoc("")).toBe(0);
  });
});

describe("isBinary", () => {
  it("detects a zero byte as binary", () => {
    expect(isBinary(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01]))).toBe(true);
  });

  it("treats normal text as not binary", () => {
    expect(isBinary(Buffer.from("const x = 1;\n", "utf8"))).toBe(false);
  });
});
