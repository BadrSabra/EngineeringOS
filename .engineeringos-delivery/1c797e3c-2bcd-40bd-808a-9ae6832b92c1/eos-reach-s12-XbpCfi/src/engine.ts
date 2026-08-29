import { computeCentrality } from './lib';
export function runEngine(graph: unknown) {
  return computeCentrality(graph);
}