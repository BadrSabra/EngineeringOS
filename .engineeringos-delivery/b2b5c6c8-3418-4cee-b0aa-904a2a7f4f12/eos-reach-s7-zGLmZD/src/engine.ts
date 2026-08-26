export function runEngine(graph: unknown) {
  return computeCentrality(graph, { maxDepth: 5 });
}