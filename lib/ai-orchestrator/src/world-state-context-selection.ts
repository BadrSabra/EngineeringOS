/**
 * Evidence-aware selection for the World State prompt projection.
 *
 * The DB projection is intentionally broader than one turn. Before it enters
 * model context, bind it to the exact repository revision, exclude stale
 * environment observations, and reserve prompt capacity for counterevidence.
 */

export type WorldStateContextFact = {
  id: string;
  subject: string;
  predicate: string;
  value: unknown;
  version: number;
  status: "believed" | "confirmed" | "contradicted" | "superseded" | "retracted";
  projectRevision: string;
  taskScope: string;
  environmentRevision: string | null;
  environmentFreshness: "fresh" | "stale" | "unknown";
};

export type SelectedWorldStateContextFact = {
  fact: WorldStateContextFact;
  kind: "current" | "contradicted";
};

export type WorldStateContextSelection = {
  selected: SelectedWorldStateContextFact[];
  currentRevisionFacts: number;
  contradictionFacts: number;
  olderRevisionFacts: number;
  staleEnvironmentFacts: number;
  retiredFacts: number;
  omittedCurrentFacts: number;
  omittedContradictions: number;
};

export const WORLD_STATE_CONTEXT_FACT_LIMIT = 32;
export const WORLD_STATE_CONTEXT_CONTRADICTION_LIMIT = 8;

const ACTIVE_STATUSES = new Set(["believed", "confirmed"]);

function compareEvidence(
  left: WorldStateContextFact,
  right: WorldStateContextFact,
): number {
  const freshnessRank = (value: WorldStateContextFact["environmentFreshness"]) =>
    value === "fresh" ? 0 : value === "unknown" ? 1 : 2;

  return freshnessRank(left.environmentFreshness) - freshnessRank(right.environmentFreshness)
    || right.version - left.version
    || left.subject.localeCompare(right.subject)
    || left.predicate.localeCompare(right.predicate)
    || left.id.localeCompare(right.id);
}

/**
 * Selects only evidence bound to the current repository revision.
 *
 * Unknown environment freshness is retained but stays explicitly labelled by
 * the serializer. Stale environment observations, facts from other revisions,
 * and superseded/retracted history are counted and withheld. Contradictions
 * receive a reserved share of the bounded output so positive facts cannot
 * crowd them out.
 */
export function selectWorldStateContextFacts(
  facts: readonly WorldStateContextFact[],
  projectRevision: string,
): WorldStateContextSelection {
  const revisionFacts = facts.filter((fact) => fact.projectRevision === projectRevision);
  const staleEnvironmentFacts = revisionFacts.filter(
    (fact) => fact.environmentFreshness === "stale",
  ).length;
  const retiredFacts = revisionFacts.filter(
    (fact) => fact.status === "superseded" || fact.status === "retracted",
  ).length;

  const eligible = revisionFacts.filter(
    (fact) =>
      fact.environmentFreshness !== "stale"
      && (ACTIVE_STATUSES.has(fact.status) || fact.status === "contradicted"),
  );
  const contradictionCandidates = eligible
    .filter((fact) => fact.status === "contradicted")
    .sort(compareEvidence);
  const currentCandidates = eligible
    .filter((fact) => ACTIVE_STATUSES.has(fact.status))
    .sort(compareEvidence);

  const selectedContradictions = contradictionCandidates.slice(
    0,
    WORLD_STATE_CONTEXT_CONTRADICTION_LIMIT,
  );
  const remainingSlots = WORLD_STATE_CONTEXT_FACT_LIMIT - selectedContradictions.length;
  const selectedCurrent = currentCandidates.slice(0, remainingSlots);

  return {
    selected: [
      ...selectedContradictions.map((fact) => ({ fact, kind: "contradicted" as const })),
      ...selectedCurrent.map((fact) => ({ fact, kind: "current" as const })),
    ],
    currentRevisionFacts: eligible.length,
    contradictionFacts: contradictionCandidates.length,
    olderRevisionFacts: facts.length - revisionFacts.length,
    staleEnvironmentFacts,
    retiredFacts,
    omittedCurrentFacts: currentCandidates.length - selectedCurrent.length,
    omittedContradictions: contradictionCandidates.length - selectedContradictions.length,
  };
}
