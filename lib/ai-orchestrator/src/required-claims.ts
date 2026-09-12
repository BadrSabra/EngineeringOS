import type { EvidenceReference } from "./task-contracts.js";
import { distinctExplicitSourcePaths } from "./task-contracts.js";
import type { ObjectiveContract } from "./schemas/chat.schema.js";

/**
 * FEG-011/012 — Required Claims closure.
 *
 * An evidence inventory is NOT an answer. A behavioral question carries a set
 * of Required Claims (Claim → Evidence → Status) that must each be CLOSED
 * before the answer may be treated as final:
 *
 *   - A claim is CLOSED when the run retained at least one grounded source
 *     excerpt that asserts it (a read exists AND a non-empty exact excerpt is
 *     cited for that claim). This deliberately mirrors AI-009: a correct,
 *     grounded behavior answer is final even when it proves no defect Finding —
 *     grounding the claim closes it, not reaching BEHAVIOR_PROVEN.
 *   - A claim is UNCLOSED when the investigation did not ground that specific
 *     claim. Finalization is blocked while ANY required claim is unclosed.
 *
 * The required claim set is derived from the QUESTION, not from evidence:
 *
 *   1. Primary claim — the question restated as the assertion it demands.
 *   2. One source-scoped claim per distinct explicit source file named in the
 *      question. A question that names multiple files (e.g. "Does A's run()
 *      call B's cleanup()?") requires EACH named file to be grounded before the
 *      answer can finalize — grounding one assertion/file alone is not enough.
 *
 * A source-scoped claim derives from `distinctExplicitSourcePaths(question)`,
 * so it can be UNCLOSED in the live path even when the validator only ever
 * surfaces excerpt-bearing evidence: the question is the source of truth for
 * what must be closed, the consumed evidence is the proof of closure.
 */

export type RequiredClaimStatus = "CLOSED" | "UNCLOSED";

export type RequiredClaim = {
  claimId: string;
  /** Human-readable behavior assertion this claim demands to be closed. */
  text: string;
  kind: "primary" | "source" | "objective";
  /** The file this claim is scoped to, when kind === "source" or "objective". */
  source?: string;
  status: RequiredClaimStatus;
  /** Read paths that were assessed for (or close) this claim, bounded. */
  evidencePaths: string[];
  /** Why the claim is unclosed, when it is. */
  reason?: string;
};

export type RequiredClaimClosure = {
  /** The full Required Claims set tracked as Claim → Evidence → Status. */
  requiredClaims: RequiredClaim[];
  /** All required claims whose status is UNCLOSED (bounded). */
  unclosedRequiredClaims: RequiredClaim[];
  /** True when any completed source read was retained during the run. */
  evidenceAvailable: boolean;
  /** The question's central claim. */
  primaryClaim: RequiredClaim | null;
  /** True only when the primary claim is CLOSED by grounded evidence. */
  primaryClaimClosed: boolean;
  /** True when ANY required claim is UNCLOSED — final answer must be blocked. */
  claimClosureBlocked: boolean;
};

export type MaterializedObjectiveClaimEvidence = {
  claimId: string;
  source: string;
  excerpt: string;
  sourceSpan: {
    startLine: number;
    endLine: number;
  };
};

export type ObjectiveEvidenceWindow = {
  file: string;
  content: string;
  startLine: number;
  endLine: number;
};

// Closure MUST evaluate every explicit source the question names — a question
// that names N files requires each of the N to be grounded before finalization.
// Only outward payloads (diagnostic details/reasons/evidence paths) are capped.
const MAX_UNCLOSED_REASONS = 8;
const MAX_DISPLAY_EVIDENCE = 24;

/** Trim trailing question punctuation so the assertion reads naturally. */
function assertionText(question: string): string {
  return question.trim().replace(/[?؟]\s*$/, "").trim() || question.trim();
}

/** True when an evidence reference carries a non-empty exact cited excerpt. */
function isGrounded(item: EvidenceReference): boolean {
  return Boolean(item.source && item.excerpt && item.excerpt.trim().length >= 3);
}

/** Exact source path captured on an evidence reference (already normalized). */
function sourceOfEvidence(item: EvidenceReference): string {
  return (item.source ?? "").replace(/\\/g, "/").replace(/^\.\/+/, "").replace(/^\/+/, "");
}

/**
 * Evaluate required-claim closure for a behavioral question.
 *
 * @param question  The user's behavioral question (message). It is the source
 *                  of truth for the required claim set.
 * @param evidence  Validated `EvidenceReference[]` for the answer (the proof
 *                  of closure). READ_CONFIRMED items still close when carried
 *                  as a non-empty excerpt (AI-009).
 * @param fileContents Completed read bodies retained during the run, keyed by
 *                  project-relative path (the evidence inventory).
 */
export function evaluateBehaviorRequiredClaims(input: {
  question: string;
  evidence: readonly EvidenceReference[];
  fileContents: ReadonlyMap<string, string>;
}): RequiredClaimClosure {
  const { question, evidence, fileContents } = input;

  const grounded = evidence.filter(isGrounded);
  const evidenceAvailable = fileContents.size > 0 || evidence.length > 0;

  const requiredClaims: RequiredClaim[] = [];

  // 1. Primary claim — the question restated as its demanded assertion. Closed
  //    when the answer grounds any exact excerpt relevant to the question.
  const primPrimary = grounded.length > 0;
  const primary: RequiredClaim = {
    claimId: "primary",
    text: assertionText(question),
    kind: "primary",
    status: primPrimary ? "CLOSED" : "UNCLOSED",
    evidencePaths: grounded.slice(0, MAX_DISPLAY_EVIDENCE).map((item) => sourceOfEvidence(item)),
    ...(primPrimary
      ? {}
      : {
          reason: evidenceAvailable
            ? "evidence was retained but the answer did not ground the question in a cited source excerpt"
            : "no grounded source evidence was produced for the question",
        }),
  };
  requiredClaims.push(primary);

  // 2. Source-scoped claims — one per distinct EXPLICIT source file named in
  //    the QUESTION. Each must be grounded before the answer can finalize; a
  //    question that names multiple files cannot be closed by grounding only
  //    one. This is the multi-claim regression FEG-011/012 targets.
  const questionSources = distinctExplicitSourcePaths(question).filter(Boolean);
  const groundedBySource = new Map<string, EvidenceReference>();
  for (const item of grounded) {
    const src = sourceOfEvidence(item);
    if (src && !groundedBySource.has(src)) groundedBySource.set(src, item);
  }
  for (const srcPath of questionSources.sort()) {
    const closedRef = groundedBySource.get(srcPath);
    requiredClaims.push({
      claimId: `src:${srcPath}`,
      text: `the behavior asserted for ${srcPath} is grounded in a retained, cited read`,
      kind: "source",
      source: srcPath,
      status: closedRef ? "CLOSED" : "UNCLOSED",
      evidencePaths: closedRef ? [srcPath] : [],
      ...(closedRef
        ? {}
        : { reason: `the question names ${srcPath}, but the answer grounds no excerpt from it` }),
    });
  }

  const primaryClaim = requiredClaims.find((c) => c.claimId === "primary") ?? null;
  const unclosedRequiredClaims = requiredClaims
    .filter((c) => c.status === "UNCLOSED")
    .slice(0, MAX_UNCLOSED_REASONS);
  const primaryClaimClosed = primary?.status === "CLOSED";

  // FEG-011/012: the answer is only final when EVERY required claim is CLOSED.
  // Grounding one assertion/file is not enough: any unclosed required claim
  // (primary OR source-scoped) blocks finalization.
  const claimClosureBlocked = unclosedRequiredClaims.length > 0;

  return {
    requiredClaims,
    unclosedRequiredClaims,
    evidenceAvailable,
    primaryClaim,
    primaryClaimClosed,
    claimClosureBlocked,
  };
}

/**
 * AI-OBJ-001/002: decompose a declared objective into its Required Claims
 * BEFORE the first source read. Unlike `evaluateBehaviorRequiredClaims` (which
 * derives the claim set from the question at evaluation time), this derives it
 * from the objective contract up front so the investigation knows the full set
 * of claims/edges that must close before finalization — not only once evidence
 * has already been collected. It is deliberately pure: no evidence is consulted.
 *
 * Each required claim starts UNCLOSED; closure is evaluated later against the
 * collected evidence reachability edges (AI-OBJ-005 Objective Completion Gate).
 */
export function decomposeObjectiveClaims(objective: ObjectiveContract): RequiredClaim[] {
  const claims: RequiredClaim[] = objective.requiredClaims.map((rc) => ({
    claimId: `objective:${rc.claimId}`,
    text: rc.text,
    kind: "objective",
    status: "UNCLOSED",
    evidencePaths: [],
  }));
  // Each required evidence edge is a claim that "a proved edge between these
  // symbols/endpoints exists" — import/package membership alone cannot close it.
  for (const edge of objective.requiredEvidenceEdges) {
    claims.push({
      claimId: `edge:${edge.from}->${edge.to}`,
      text: `a proved ${edge.relationship} edge from ${edge.from} to ${edge.to} exists in the source trace`,
      kind: "objective",
      status: "UNCLOSED",
      evidencePaths: [],
    });
  }
  return claims;
}

/**
 * Build claim evidence from the server-owned retained source bodies.
 *
 * This is intentionally independent of provider prose. It is used only after
 * the objective manifest is complete, and it never searches the filesystem or
 * accepts a path supplied by the model. Each returned excerpt contains the
 * server-owned source needle plus a small surrounding source window so the
 * normal evidence ledger can retain a verifiable span. A behavioral claim's
 * prose does not need to appear verbatim in source code.
 */
export function materializeObjectiveClaimEvidence(input: {
  objective: ObjectiveContract;
  fileContents: ReadonlyMap<string, string>;
  sourceWindows?: readonly ObjectiveEvidenceWindow[];
}): MaterializedObjectiveClaimEvidence[] {
  const normalizePath = (value: string): string =>
    value.replace(/\\/g, "/").replace(/^\.\/+/, "").replace(/^\/+/, "");
  const lineOf = (content: string, index: number): number =>
    (content.slice(0, index).match(/\n/g)?.length ?? 0) + 1;
  const windowEntries = (input.sourceWindows ?? []).map((window) => ({
    path: normalizePath(window.file),
    content: window.content,
    lines: window.content.split("\n"),
    baseLine: window.startLine,
  }));
  // Prefer bounded windows because they carry absolute source spans, but do
  // not let a window shadow the retained body for the same path. A bounded
  // window may be valid evidence for one claim while omitting another needle
  // in the same source file. The retained body is an accepted fallback, never
  // a locator body, and keeps materialization aligned with the evidence
  // snapshot's per-path read inventory.
  const bodyEntries = [
    ...windowEntries,
    ...[...input.fileContents.entries()]
      .map(([path, content]) => ({
        path: normalizePath(path),
        content,
        lines: content.split("\n"),
        baseLine: 1,
      })),
  ];
  const results: MaterializedObjectiveClaimEvidence[] = [];

  for (const claim of input.objective.requiredClaims) {
    const claimNeedle = claim.text.trim();
    const preferredPaths = (claim.requiredEvidencePaths ?? []).map(normalizePath);
    // A claim with an explicit evidence manifest must be grounded in one of
    // those paths. Falling back to an unrelated retained body lets a matching
    // symbol close the claim without satisfying the server-owned objective
    // scope.
    const candidates = preferredPaths.length > 0
      ? bodyEntries.filter((entry) => preferredPaths.includes(entry.path))
      : bodyEntries;
    const match = candidates
      .flatMap((entry) => {
        const evidenceNeedles = claim.evidenceNeedlesByPath
          ? Object.entries(claim.evidenceNeedlesByPath)
              .find(([path]) => normalizePath(path) === entry.path)?.[1] ?? []
          : claim.evidenceNeedles ?? [claimNeedle];
        return evidenceNeedles.map((needle) => ({
          entry,
          needle: needle.trim(),
          index: entry.content.indexOf(needle),
        }));
      })
      .filter((candidate) => candidate.needle.length > 0)
      .find((candidate) => candidate.index >= 0);
    if (!match) continue;

    const localStartLine = Math.max(1, lineOf(match.entry.content, match.index) - 2);
    const localEndLine = Math.min(match.entry.lines.length, localStartLine + 6);
    const startLine = match.entry.baseLine + localStartLine - 1;
    const endLine = match.entry.baseLine + localEndLine - 1;
    const excerpt = match.entry.lines
      .slice(localStartLine - 1, localEndLine)
      .join("\n")
      .trim();
    if (!excerpt || !excerpt.includes(match.needle)) continue;
    results.push({
      claimId: claim.claimId,
      source: match.entry.path,
      excerpt,
      sourceSpan: { startLine, endLine },
    });
  }
  return results;
}

/**
 * AI-OBJ-002 (grounded, response-bound closure): mark which objective REQUIRED
 * CLAIMS are CLOSED by grounded source evidence gathered during the run. This is
 * what lets a genuinely completed objective actually reach PROVEN in a real
 * chat() run — without it the gate could only ever block a claimed-but-ungrounded
 * objective.
 *
 * A required claim (non-edge) closes ONLY when BOTH of the following hold:
 *   1. The run retained a read whose body contains the claim's source evidence
 *      needle (the evidence inventory `fileContents` / completed reads), AND
 *   2. The candidate answer actually asserts the claim — its text appears in the
 *      response. A read that merely happens to contain the words is NOT enough:
 *      a response that never answers the objective must stay unclosed, so a claim
 *      cannot receive PROVEN off an unrelated/full-file read.
 * When grounded behavior evidence is supplied, the file must ALSO be one the run
 * cited an exact excerpt from, tying the claim to a cited read rather than any
 * byte of context. Mirroring FEG-011/012 / AI-009, grounding closes the claim —
 * NOT reaching a concrete Finding. Edge-derived claims are intentionally left
 * alone here (closing edges requires the runtime/evidence endpoints in
 * closeObjectiveClaimsFromEdges).
 */
export function closeObjectiveClaimsFromEvidence(input: {
  objective: ObjectiveContract;
  /** Candidate answer text — the claim must be asserted here to close. */
  response: string;
  evidence?: readonly EvidenceReference[];
  fileContents?: ReadonlyMap<string, string>;
  /**
   * Project-query objectives use a server-owned materialized evidence
   * projection. Other objective types retain their reachability closure
   * semantics.
   */
  requireAcceptedEvidence?: boolean;
}): RequiredClaim[] {
  const {
    objective,
    response = "",
    evidence = [],
    fileContents = new Map(),
    requireAcceptedEvidence = false,
  } = input;
  const groundedSources = new Set(
    evidence
      .filter((item) => item.source && item.excerpt && item.excerpt.trim().length >= 3)
      .map((item) => sourceOfEvidence(item))
      .filter(Boolean),
  );
  const requireCited = requireAcceptedEvidence || groundedSources.size > 0;
  const normalize = (s: string): string => s.toLowerCase().replace(/\s+/g, " ").trim();
  const bodies = new Map<string, string>();
  for (const [path, body] of fileContents) {
    const rel = path.replace(/\\/g, "/").replace(/^\.\/+/, "").replace(/^\/+/, "");
    bodies.set(rel, normalize(body));
  }
  const responseNorm = normalize(response);
  return decomposeObjectiveClaims(objective).map((claim) => {
    if (claim.kind !== "objective") return claim; // not an objective claim
    if (claim.claimId.startsWith("edge:")) return claim; // edges handled separately
    // Grounded AND response-bound: the assertion must appear in a retained read
    // (optionally one cited) AND be asserted by the candidate answer itself.
    let closed = false;
    let path = "";
    const claimSpec = objective.requiredClaims.find(
      (candidate) => `objective:${candidate.claimId}` === claim.claimId,
    );
    const responseNeedle = normalize(claim.text);
    const preferredPaths = (claimSpec?.requiredEvidencePaths ?? []).map((path: string) =>
      path.replace(/\\/g, "/").replace(/^\.\/+/, "").replace(/^\/+/, ""),
    );
    if (responseNeedle.length >= 3 && responseNorm.includes(responseNeedle)) {
      for (const [file, body] of bodies) {
        const sourceNeedles = claimSpec?.evidenceNeedlesByPath
          ? Object.entries(claimSpec.evidenceNeedlesByPath)
              .find(([candidatePath]) => normalize(candidatePath) === file)?.[1] ?? []
          : claimSpec?.evidenceNeedles ?? [claim.text];
        const normalizedSourceNeedles = sourceNeedles
          .map((needle: string) => normalize(needle))
          .filter(Boolean);
        if (
          normalizedSourceNeedles.some((needle) => body.includes(needle)) &&
          (!requireCited || groundedSources.has(file)) &&
          (preferredPaths.length === 0 || preferredPaths.includes(file))
        ) {
          closed = true;
          path = file;
          break;
        }
      }
    }
    return closed
      ? { ...claim, status: "CLOSED" as const, evidencePaths: path ? [path] : [] }
      : claim;
  });
}

/**
 * AI-OBJ-002: mark which objective-derived claims are CLOSED by the accepted
 * reachability edges already proven at runtime. A required evidence edge closes
 * only when the edge with the same endpoints carried runtime/evidence proof —
 * a bare import or static reference does not.
 */
export function closeObjectiveClaimsFromEdges(input: {
  objective: ObjectiveContract;
  provenEdges?: readonly { from?: string; to?: string }[];
}): RequiredClaim[] {
  const { objective, provenEdges = [] } = input;
  const provenKeys = new Set(
    provenEdges
      .filter((e) => e.from && e.to)
      .map((e) => `${e.from}->${e.to}`),
  );
  return decomposeObjectiveClaims(objective).map((claim) => {
    if (claim.kind !== "objective") return claim;
    const edgeKey = claim.claimId.startsWith("edge:")
      ? claim.claimId.slice("edge:".length)
      : undefined;
    const closed =
      edgeKey !== undefined
        ? provenKeys.has(edgeKey)
        : false;
    return closed
      ? { ...claim, status: "CLOSED" as const, evidencePaths: edgeKey ? [edgeKey] : [] }
      : claim;
  });
}
