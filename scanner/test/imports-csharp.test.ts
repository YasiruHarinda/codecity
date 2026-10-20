import { describe, expect, it } from "vitest";
import { parseCSharp, resolveCSharp, type CSharpFacts } from "../src/imports/csharp";

describe("parseCSharp", () => {
  it("reads namespaces, usings, declared types and used names", () => {
    const facts = parseCSharp(`
      global using Shared.Kernel;
      using Orders.Domain;
      using static Orders.Domain.OrderRules;
      using Json = System.Text.Json;
      // using Commented.Out;

      namespace Orders.Application;

      public sealed record PlaceOrderCommand(Guid CustomerId);
      public class PlaceOrderHandler
      {
          public Order Handle(PlaceOrderCommand command) => throw new Exception("Customer failed");
      }
    `);

    expect(facts.namespaces).toEqual(["Orders.Application"]);
    expect(facts.usings).toEqual(["Orders.Domain", "Orders.Domain.OrderRules", "System.Text.Json"]);
    expect(facts.globalUsings).toEqual(["Shared.Kernel"]);
    expect(facts.declaredTypes).toEqual(["PlaceOrderCommand", "PlaceOrderHandler"]);
    expect(facts.usedNames).toContain("Order");
    expect(facts.usedNames).not.toContain("Customer"); // only inside a string
    expect(facts.usedNames).not.toContain("Commented");
  });

  it("doesn't treat `using var x = ...` statements as imports", () => {
    expect(parseCSharp("using var stream = File.OpenRead(path);").usings).toEqual([]);
  });
});

describe("resolveCSharp", () => {
  const files = new Map<string, CSharpFacts>([
    ["Domain/Order.cs", parseCSharp("namespace Orders.Domain; public class Order { }")],
    ["Domain/OrderLine.cs", parseCSharp("namespace Orders.Domain; public class OrderLine { Order Parent; }")],
    ["Domain/Unused.cs", parseCSharp("namespace Orders.Domain; public class Unused { }")],
    [
      "App/Handler.cs",
      parseCSharp("using Orders.Domain; namespace Orders.App { class Handler { Order Load() => null; } }"),
    ],
    ["App/Other.cs", parseCSharp("namespace Elsewhere; class Other { Order NotVisible; }")],
  ]);
  const deps = resolveCSharp(files);

  it("links to files declaring a type the file uses, in a namespace it imports", () => {
    expect(deps.get("App/Handler.cs")).toEqual(["Domain/Order.cs"]);
  });

  it("sees its own namespace without a using", () => {
    expect(deps.get("Domain/OrderLine.cs")).toEqual(["Domain/Order.cs"]);
  });

  it("does not link to types in namespaces it can't see", () => {
    expect(deps.get("App/Other.cs")).toEqual([]);
  });

  it("does not link to every file in an imported namespace", () => {
    expect(deps.get("App/Handler.cs")).not.toContain("Domain/Unused.cs");
  });

  it("does not link parts of the same partial class to each other", () => {
    const partial = resolveCSharp(
      new Map([
        ["Migration.cs", parseCSharp("namespace Db; public partial class Migration { Migration() {} }")],
        ["Migration.Designer.cs", parseCSharp("namespace Db; partial class Migration { void Build(Migration m) {} }")],
      ]),
    );
    expect(partial.get("Migration.cs")).toEqual([]);
    expect(partial.get("Migration.Designer.cs")).toEqual([]);
  });
});
