import { describe, expect, it } from "vitest";
import { detectLanguage } from "../src/languages";

describe("detectLanguage", () => {
  it("detects by extension, case-insensitive", () => {
    expect(detectLanguage("src/app.ts")).toBe("TypeScript");
    expect(detectLanguage("Program.CS")).toBe("C#");
    expect(detectLanguage("tools/run.py")).toBe("Python");
  });

  it("detects special file names", () => {
    expect(detectLanguage("deploy/Dockerfile")).toBe("Dockerfile");
  });

  it("skips unknown, lock and minified files", () => {
    expect(detectLanguage("logo.png")).toBeNull();
    expect(detectLanguage("package-lock.json")).toBeNull();
    expect(detectLanguage("vendor/jquery.min.js")).toBeNull();
  });
});
