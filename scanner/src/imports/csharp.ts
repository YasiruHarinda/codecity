import { stripCStyleComments } from "./strip";

/** What one C# file says about namespaces and types. */
export interface CSharpFacts {
  /** Namespaces this file declares its types in. */
  namespaces: string[];
  /** `using X.Y;` lines (a `global using` applies to every file in the project). */
  usings: string[];
  globalUsings: string[];
  /** Types declared here: class, interface, struct, enum, record. */
  declaredTypes: string[];
  /** Capitalised words used in the code — candidate type names this file refers to. */
  usedNames: string[];
}

const NAMESPACE = /\bnamespace\s+([\w.]+)/g;
// using X.Y;  ·  global using X.Y;  ·  using static X.Y.Z;  ·  using Alias = X.Y.Z;
const USING = /^[ \t]*(global[ \t]+)?using[ \t]+(?:static[ \t]+)?(?:\w+[ \t]*=[ \t]*)?([\w.]+)[ \t]*;/gm;
const TYPE_DECLARATION = /\b(?:class|interface|struct|enum|record(?:\s+(?:class|struct))?)\s+([A-Za-z_]\w*)/g;
const CAPITALISED_WORD = /\b[A-Z_]\w*\b/g;

export function parseCSharp(source: string): CSharpFacts {
  const code = stripCStyleComments(source);
  const usings: string[] = [];
  const globalUsings: string[] = [];
  for (const [, isGlobal, name] of code.matchAll(USING)) {
    (isGlobal ? globalUsings : usings).push(name);
  }

  // For finding type names, ignore words inside strings too ("Order failed" is not a type reference).
  const codeOnly = stripCStyleComments(source, false);
  return {
    namespaces: [...code.matchAll(NAMESPACE)].map((match) => match[1]),
    usings,
    globalUsings,
    declaredTypes: [...code.matchAll(TYPE_DECLARATION)].map((match) => match[1]),
    usedNames: [...new Set(codeOnly.match(CAPITALISED_WORD) ?? [])],
  };
}

/**
 * C# imports namespaces, not files: `using Orders.Domain;` makes every type in that namespace
 * available. Linking to every file in the namespace would draw lots of false edges, so instead:
 * a file depends on another file if it MENTIONS A TYPE that the other file declares, in a
 * namespace it can see. Visible namespaces are:
 *   - its `using`s, plus every `global using` in the repo
 *   - its own namespace and the ones containing it (code in A.B.C can see A.B and A)
 *   - for `using static X.Y.Z`, also X.Y (Z is a type there)
 * Parts of the same `partial class` in different files are not linked to each other.
 */
export function resolveCSharp(factsByFile: Map<string, CSharpFacts>): Map<string, string[]> {
  // namespace → type name → files declaring it (several for partial classes)
  const typeIndex = new Map<string, Map<string, string[]>>();
  const globalUsings = new Set<string>();

  for (const [file, facts] of factsByFile) {
    facts.globalUsings.forEach((name) => globalUsings.add(name));
    // Types in a file without a namespace live in the "global" namespace, written as "".
    for (const namespace of facts.namespaces.length > 0 ? facts.namespaces : [""]) {
      let types = typeIndex.get(namespace);
      if (!types) typeIndex.set(namespace, (types = new Map()));
      for (const type of facts.declaredTypes) types.set(type, [...(types.get(type) ?? []), file]);
    }
  }

  const result = new Map<string, string[]>();
  for (const [file, facts] of factsByFile) {
    const visible = new Set<string>([""]);
    for (const name of [...facts.usings, ...globalUsings]) {
      visible.add(name);
      visible.add(parentNamespace(name)); // using static X.Y.Z → X.Y
    }
    for (let namespace of facts.namespaces) {
      while (namespace) {
        visible.add(namespace);
        namespace = parentNamespace(namespace);
      }
    }

    const dependencies = new Set<string>();
    const ownTypes = new Set(facts.declaredTypes);
    for (const name of facts.usedNames) {
      // A type this file declares itself: other files declaring it are parts of the same
      // `partial class` (e.g. Migration.cs + Migration.Designer.cs), not dependencies.
      if (ownTypes.has(name)) continue;
      for (const namespace of visible) {
        for (const target of typeIndex.get(namespace)?.get(name) ?? []) {
          if (target !== file) dependencies.add(target);
        }
      }
    }
    result.set(file, [...dependencies]);
  }
  return result;
}

function parentNamespace(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "" : name.slice(0, dot);
}
