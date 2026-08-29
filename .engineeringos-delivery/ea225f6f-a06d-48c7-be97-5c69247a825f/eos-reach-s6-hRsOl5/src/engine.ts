import { computeCentrality } from './lib';
export function runEngine(graph: unknown) {
  // Invoke the target function directly
  return computeCentrality(graph, { maxDepth: 5 });
}