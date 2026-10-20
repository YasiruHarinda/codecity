/**
 * Finds circular dependencies with Tarjan's strongly-connected-components algorithm.
 *
 * A strongly connected component (SCC) is a group of files where each one can reach every
 * other one by following imports. Any SCC with 2+ files — or a file importing itself — is a cycle.
 *
 * Tarjan does one depth-first search (DFS):
 *   - each file gets a visit number `index` and is pushed onto a stack
 *   - `lowlink` = the smallest index reachable from that file through files still on the stack
 *   - when a file finishes with lowlink === index, it is the root of an SCC:
 *     pop the stack down to it, and everything popped is one SCC
 *
 * Written with an explicit stack instead of recursion, because a long chain of imports
 * (thousands of files deep) would overflow JavaScript's call stack.
 *
 * @param graph file → files it imports
 * @returns every cycle, each a sorted list of file paths (biggest cycles first)
 */
export function findCycles(graph: Map<string, string[]>): string[][] {
  const index = new Map<string, number>();
  const lowlink = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const cycles: string[][] = [];
  let nextIndex = 0;

  for (const start of graph.keys()) {
    if (index.has(start)) continue;

    // Each frame is "a file we're visiting, and which of its imports to look at next".
    const work: { node: string; next: number }[] = [{ node: start, next: 0 }];
    index.set(start, nextIndex);
    lowlink.set(start, nextIndex++);
    stack.push(start);
    onStack.add(start);

    while (work.length > 0) {
      const frame = work[work.length - 1];
      const neighbours = graph.get(frame.node) ?? [];

      if (frame.next < neighbours.length) {
        const neighbour = neighbours[frame.next++];
        if (!index.has(neighbour)) {
          // Not visited yet: "recurse" into it.
          index.set(neighbour, nextIndex);
          lowlink.set(neighbour, nextIndex++);
          stack.push(neighbour);
          onStack.add(neighbour);
          work.push({ node: neighbour, next: 0 });
        } else if (onStack.has(neighbour)) {
          // Points back into the current path: we can reach something visited earlier.
          lowlink.set(frame.node, Math.min(lowlink.get(frame.node)!, index.get(neighbour)!));
        }
        continue;
      }

      // Finished all imports of this file — "return" to its caller.
      work.pop();
      const parent = work[work.length - 1];
      if (parent) lowlink.set(parent.node, Math.min(lowlink.get(parent.node)!, lowlink.get(frame.node)!));

      if (lowlink.get(frame.node) === index.get(frame.node)) {
        // Root of an SCC: everything above it on the stack belongs to the same group.
        const component: string[] = [];
        let member: string;
        do {
          member = stack.pop()!;
          onStack.delete(member);
          component.push(member);
        } while (member !== frame.node);

        const importsItself = (graph.get(frame.node) ?? []).includes(frame.node);
        if (component.length > 1 || importsItself) cycles.push(component.sort());
      }
    }
  }

  return cycles.sort((a, b) => b.length - a.length || a[0].localeCompare(b[0]));
}
