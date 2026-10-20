import { describe, expect, it } from "vitest";
import { createPythonResolver, parsePythonImports } from "../src/imports/python";

describe("parsePythonImports", () => {
  it("finds import and from-import lines", () => {
    const source = [
      "import os, sys as system",
      "import app.models",
      "from app.services import billing, email as mail",
      "from . import helpers",
      "from ..core.db import (",
      "    Session,",
      "    engine,",
      ")",
      "from pkg import *",
    ].join("\n");

    expect(parsePythonImports(source)).toEqual([
      { module: "os", names: [] },
      { module: "sys", names: [] },
      { module: "app.models", names: [] },
      { module: "app.services", names: ["billing", "email"] },
      { module: ".", names: ["helpers"] },
      { module: "..core.db", names: ["Session", "engine"] },
      { module: "pkg", names: [] },
    ]);
  });

  it("ignores comments and docstrings", () => {
    const source = ['"""', "import fake_in_docstring", '"""', "# import fake_in_comment", "import real"].join("\n");
    expect(parsePythonImports(source)).toEqual([{ module: "real", names: [] }]);
  });
});

describe("python resolver", () => {
  const resolve = createPythonResolver([
    "src/app/__init__.py",
    "src/app/models.py",
    "src/app/services/__init__.py",
    "src/app/services/billing.py",
    "src/app/core/db.py",
    "src/app/api/routes.py",
    "scripts/run.py",
  ]);

  it("resolves absolute imports, even under a src/ folder", () => {
    expect(resolve("scripts/run.py", { module: "app.models", names: [] })).toEqual(["src/app/models.py"]);
  });

  it("resolves `from package import submodule` to the submodule file", () => {
    expect(resolve("scripts/run.py", { module: "app.services", names: ["billing"] })).toEqual([
      "src/app/services/billing.py",
    ]);
  });

  it("falls back to the package when the name is not a submodule", () => {
    expect(resolve("scripts/run.py", { module: "app.services", names: ["SomeClass"] })).toEqual([
      "src/app/services/__init__.py",
    ]);
  });

  it("resolves relative imports", () => {
    expect(resolve("src/app/api/routes.py", { module: "..core.db", names: ["Session"] })).toEqual([
      "src/app/core/db.py",
    ]);
    expect(resolve("src/app/api/routes.py", { module: "..", names: ["models"] })).toEqual(["src/app/models.py"]);
  });

  it("ignores the standard library and other packages", () => {
    expect(resolve("scripts/run.py", { module: "os", names: [] })).toEqual([]);
  });
});
