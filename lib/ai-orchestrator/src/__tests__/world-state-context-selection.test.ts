import { describe, expect, it } from "vitest";
import {
  selectWorldStateContextFacts,
  WORLD_STATE_CONTEXT_FACT_LIMIT,
  WORLD_STATE_CONTEXT_CONTRADICTION_LIMIT,
  type WorldStateContextFact,
} from "../world-state-context-selection.js";

function fact(overrides: Partial<WorldStateContextFact> = {}): WorldStateContextFact {
  return {
    id: "fact-1",
    subject: "execution:build",
    predicate: "runtime.status",
    value: { status: "passed" },
    version: 1,
    status: "believed",
    projectRevision: "revision-current",
    taskScope: "build",
    environmentRevision: "environment-a",
    environmentFreshness: "fresh",
    ...overrides,
  };
}

describe("World State context selection", () => {
  it("withholds facts from other project revisions and stale environments", () => {
    const facts = [
      fact({ id: "fresh", value: "fresh evidence" }),
      fact({ id: "unknown", environmentFreshness: "unknown" }),
      fact({ id: "old-revision", projectRevision: "revision-old" }),
      fact({ id: "stale-environment", environmentFreshness: "stale" }),
      fact({ id: "superseded", status: "superseded" }),
      fact({ id: "retracted", status: "retracted" }),
    ];

    const result = selectWorldStateContextFacts(facts, "revision-current");

    expect(result.selected.map(({ fact: selected }) => selected.id)).toEqual([
      "fresh",
      "unknown",
    ]);
    expect(result.olderRevisionFacts).toBe(1);
    expect(result.staleEnvironmentFacts).toBe(1);
    expect(result.retiredFacts).toBe(2);
  });

  it("reserves bounded output for contradictions even when current facts are numerous", () => {
    const currentFacts = Array.from({ length: 40 }, (_, index) =>
      fact({ id: `current-${index}`, version: index + 1 }),
    );
    const contradictions = Array.from({ length: 10 }, (_, index) =>
      fact({
        id: `contradiction-${index}`,
        status: "contradicted",
        version: index + 1,
      }),
    );

    const result = selectWorldStateContextFacts(
      [...currentFacts, ...contradictions],
      "revision-current",
    );

    expect(result.selected).toHaveLength(WORLD_STATE_CONTEXT_FACT_LIMIT);
    expect(result.selected.filter(({ kind }) => kind === "contradicted")).toHaveLength(
      WORLD_STATE_CONTEXT_CONTRADICTION_LIMIT,
    );
    expect(result.selected.filter(({ kind }) => kind === "current")).toHaveLength(
      WORLD_STATE_CONTEXT_FACT_LIMIT - WORLD_STATE_CONTEXT_CONTRADICTION_LIMIT,
    );
    expect(result.omittedContradictions).toBe(2);
    expect(result.omittedCurrentFacts).toBe(16);
  });

  it("prefers fresh evidence over unknown freshness and orders ties deterministically", () => {
    const facts = [
      fact({ id: "unknown-new", environmentFreshness: "unknown", version: 99 }),
      fact({ id: "fresh-old", environmentFreshness: "fresh", version: 1 }),
      fact({ id: "fresh-new", environmentFreshness: "fresh", version: 2 }),
      fact({ id: "fresh-tie-b", environmentFreshness: "fresh", version: 2, subject: "z" }),
    ];

    const result = selectWorldStateContextFacts(facts, "revision-current");

    expect(result.selected.map(({ fact: selected }) => selected.id)).toEqual([
      "fresh-new",
      "fresh-tie-b",
      "fresh-old",
      "unknown-new",
    ]);
  });

  it("does not admit any facts when the requested repository revision differs", () => {
    const result = selectWorldStateContextFacts(
      [fact({ projectRevision: "revision-old" })],
      "revision-current",
    );

    expect(result.selected).toEqual([]);
    expect(result.olderRevisionFacts).toBe(1);
  });
});
