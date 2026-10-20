import { describe, expect, it } from "vitest";
import { findCycles } from "../src/imports/cycles";

const graph = (edges: Record<string, string[]>) => new Map(Object.entries(edges));

describe("findCycles (Tarjan)", () => {
  it("finds nothing in a graph without cycles", () => {
    expect(findCycles(graph({ a: ["b", "c"], b: ["c"], c: [] }))).toEqual([]);
  });

  it("finds a simple cycle a → b → c → a", () => {
    expect(findCycles(graph({ a: ["b"], b: ["c"], c: ["a"], d: ["a"] }))).toEqual([["a", "b", "c"]]);
  });

  it("finds separate cycles, biggest first", () => {
    const result = findCycles(graph({ a: ["b"], b: ["a"], x: ["y"], y: ["z"], z: ["x", "a"] }));
    expect(result).toEqual([
      ["x", "y", "z"],
      ["a", "b"],
    ]);
  });

  it("treats a file importing itself as a cycle", () => {
    expect(findCycles(graph({ a: ["a"] }))).toEqual([["a"]]);
  });

  it("handles edges to files that have no entry of their own", () => {
    expect(findCycles(graph({ a: ["external"] }))).toEqual([]);
  });

  it("handles a 50,000-file chain without running out of stack", () => {
    const edges: Record<string, string[]> = {};
    for (let i = 0; i < 50_000; i++) edges[`f${i}`] = [`f${i + 1}`];
    edges["f50000"] = ["f0"]; // close the loop
    const result = findCycles(graph(edges));
    expect(result).toHaveLength(1);
    expect(result[0]).toHaveLength(50_001);
  });
});
