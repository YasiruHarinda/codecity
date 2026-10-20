import { describe, expect, it } from "vitest";
import { parseJsImports, resolveJsImport } from "../src/imports/javascript";

describe("parseJsImports", () => {
  it("finds every import form", () => {
    const source = `
      import React from "react";
      import { a, b as c } from './utils';
      import * as math from "../lib/math";
      import type { User } from "./types";
      import "./styles.css";
      import def, {
        named,
      } from "./multi-line";
      export * from "./reexport";
      export { thing } from "./thing";
      const fs = require("fs");
      const lazy = await import("./lazy");
    `;
    expect(parseJsImports(source).sort()).toEqual(
      [
        "react",
        "./utils",
        "../lib/math",
        "./types",
        "./styles.css",
        "./multi-line",
        "./reexport",
        "./thing",
        "fs",
        "./lazy",
      ].sort(),
    );
  });

  it("ignores imports inside comments", () => {
    const source = `
      // import old from "./old";
      /* import gone from "./gone"; */
      const url = "http://example.com"; // the string isn't a comment
      import kept from "./kept";
    `;
    expect(parseJsImports(source)).toEqual(["./kept"]);
  });
});

describe("resolveJsImport", () => {
  const files = new Set([
    "src/main.ts",
    "src/utils.ts",
    "src/components/Button.tsx",
    "src/lib/index.js",
    "src/styles.css",
    "shared/types.ts",
  ]);
  const resolve = (spec: string, from = "src/main.ts") => resolveJsImport(from, spec, files);

  it("adds missing extensions and finds index files", () => {
    expect(resolve("./utils")).toBe("src/utils.ts");
    expect(resolve("./components/Button")).toBe("src/components/Button.tsx");
    expect(resolve("./lib")).toBe("src/lib/index.js");
  });

  it("handles ../ and exact file names", () => {
    expect(resolve("../shared/types")).toBe("shared/types.ts");
    expect(resolve("./styles.css")).toBe("src/styles.css");
  });

  it("maps TypeScript ESM .js imports back to .ts files", () => {
    expect(resolve("./utils.js")).toBe("src/utils.ts");
  });

  it("understands the @/ alias for the src folder", () => {
    expect(resolve("@/utils", "src/components/Button.tsx")).toBe("src/utils.ts");
  });

  it("ignores packages, missing files and paths outside the repo", () => {
    expect(resolve("react")).toBeNull();
    expect(resolve("./missing")).toBeNull();
    expect(resolve("../../outside")).toBeNull();
  });
});
