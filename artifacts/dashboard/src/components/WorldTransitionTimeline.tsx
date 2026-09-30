import type {
  AiExecutionAcceptance,
  GetAiExecution200ApplyMission,
  RuntimeWorldTransitionProjection,
} from "@workspace/api-client-react";

type TimelineState = "proven" | "recorded" | "pending" | "failed" | "incomplete" | "missing";
type Observation = RuntimeWorldTransitionProjection["beforeObservations"][number];

type Props = {
  recipeId?: string;
  executionId?: string;
  attempt?: number;
  transitions?: RuntimeWorldTransitionProjection[];
  acceptance?: AiExecutionAcceptance | null;
  proofVerdict?: string;
  applyMission?: GetAiExecution200ApplyMission | null;
};

const stateLabel: Record<TimelineState, string> = {
  proven: "PROVEN",
  recorded: "RECORDED",
  pending: "PENDING",
  failed: "FAILED",
  incomplete: "INCOMPLETE",
  missing: "NOT RECORDED",
};

const stateClasses: Record<TimelineState, string> = {
  proven: "border-emerald-500/35 bg-emerald-500/10 text-emerald-200",
  recorded: "border-primary/30 bg-primary/5 text-primary",
  pending: "border-amber-500/35 bg-amber-500/5 text-amber-200",
  failed: "border-rose-500/35 bg-rose-500/5 text-rose-200",
  incomplete: "border-amber-500/35 bg-amber-500/5 text-amber-200",
  missing: "border-border/60 bg-background/20 text-muted-foreground",
};

function isBoundDirectObservation(observation: Observation | undefined): observation is Observation {
  return Boolean(
    observation
    && observation.provenance === "DIRECT_OBSERVATION"
    && observation.completeness === "complete"
    && observation.freshness === "fresh"
    && observation.environmentFreshness === "fresh"
    && (observation.predicate === "workspace.tree_hash" || observation.runtimeStatus),
  );
}

function StageCard({
  title,
  state,
  children,
}: {
  title: string;
  state: TimelineState;
  children: React.ReactNode;
}) {
  return (
    <article className={`min-w-0 rounded-lg border p-3 ${stateClasses[state]}`}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold text-foreground">{title}</h3>
        <span className="shrink-0 rounded-full border border-current/25 px-1.5 py-0.5 text-[9px] font-semibold tracking-wide">
          {stateLabel[state]}
        </span>
      </div>
      <div className="mt-2 space-y-2 text-[11px] leading-5 text-muted-foreground">
        {children}
      </div>
    </article>
  );
}

function ObservationRows({
  label,
  observations,
}: {
  label: string;
  observations: Observation[];
}) {
  if (observations.length === 0) {
    return (
      <div>
        <span className="font-medium text-foreground/80">{label}:</span> no transition-linked references
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <div className="font-medium text-foreground/80">{label}</div>
      {observations.map((observation) => (
        <div key={observation.id} className="rounded-md border border-border/45 bg-background/30 px-2 py-1.5">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span>{observation.predicate}</span>
            <span className="text-foreground">
              {observation.predicate === "workspace.tree_hash"
                ? "tree hash value not shown"
                : observation.runtimeStatus ?? "state not independently verified"}
            </span>
          </div>
          <div className="break-all font-mono text-[9px] opacity-80">{observation.id}</div>
          <div>
            {observation.provenance} · {observation.completeness} · {observation.freshness} · environment {observation.environmentFreshness}
          </div>
        </div>
      ))}
    </div>
  );
}

function AcceptanceStage({
  transition,
  executionAttempt,
  acceptance,
  proofVerdict,
}: {
  transition?: RuntimeWorldTransitionProjection;
  executionAttempt?: number;
  acceptance?: AiExecutionAcceptance | null;
  proofVerdict?: string;
}) {
  const expectedAttempt = transition?.attempt ?? executionAttempt;
  const isSameAttempt = typeof expectedAttempt === "number"
    && acceptance?.attempt === expectedAttempt;
  const isProven = isSameAttempt
    && acceptance?.outcome === "SUCCEEDED"
    && acceptance.evidenceComplete
    && proofVerdict === "PROVEN";
  const state: TimelineState = isProven
    ? "proven"
    : acceptance && !isSameAttempt
      ? "incomplete"
      : acceptance?.outcome === "FAILED"
        ? "failed"
        : acceptance
          ? "incomplete"
          : "missing";

  return (
    <StageCard title="Acceptance" state={state}>
      {!acceptance ? (
        <p>No acceptance snapshot is recorded for this attempt.</p>
      ) : (
        <>
          <p>
            {isSameAttempt ? `Attempt ${acceptance.attempt}` : `Acceptance attempt ${acceptance.attempt} does not match this transition`}
            {" · "}
            {acceptance.outcome}
          </p>
          <p>
            {isProven
              ? "Server acceptance and Canonical Proof are both PROVEN."
              : `Evidence complete: ${acceptance.evidenceComplete ? "yes" : "no"} · Canonical Proof: ${proofVerdict ?? "not proven"}`}
          </p>
        </>
      )}
    </StageCard>
  );
}

function TransitionEntry({
  transition,
  executionAttempt,
  acceptance,
  proofVerdict,
}: {
  transition?: RuntimeWorldTransitionProjection;
  executionAttempt?: number;
  acceptance?: AiExecutionAcceptance | null;
  proofVerdict?: string;
}) {
  if (!transition) {
    return (
      <div className="grid gap-2 xl:grid-cols-4">
        <StageCard title="Observation" state="missing">
          <p>No transition-linked before/after observations were returned.</p>
        </StageCard>
        <StageCard title="Effect" state="missing">
          <p>No transition-linked effect bundle was returned.</p>
        </StageCard>
        <AcceptanceStage
          executionAttempt={executionAttempt}
          acceptance={acceptance}
          proofVerdict={proofVerdict}
        />
        <StageCard title="World materialization" state="missing">
          <p>No World Transition record is available for this attempt.</p>
        </StageCard>
      </div>
    );
  }

  const beforeValid = transition.beforeObservations.some(isBoundDirectObservation);
  const afterValid = transition.afterObservations.some(isBoundDirectObservation);
  const observationsState: TimelineState = beforeValid && afterValid
    ? "recorded"
    : transition.beforeObservations.length > 0 || transition.afterObservations.length > 0
      ? "incomplete"
      : "missing";
  const effectState: TimelineState = !transition.effectBundle
    ? "missing"
    : transition.effectBundle.verdict === "OBSERVED"
      ? "recorded"
      : transition.effectBundle.verdict === "CONTRADICTED"
        ? "failed"
        : "incomplete";
  const worldState: TimelineState = transition.status === "terminal_failed"
    ? "failed"
    : transition.status === "pending" || transition.status === "retrying"
      ? "pending"
      : transition.status === "materialized"
        && Boolean(transition.resultingWorldRevision)
        && beforeValid
        && afterValid
        ? "recorded"
        : transition.status === "materialized"
          ? "incomplete"
          : "missing";

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
        <span className="font-mono">Episode {transition.episodeId}</span>
        <span className="font-mono">Action {transition.actionId}</span>
        <span className="font-mono">Attempt {transition.attempt}</span>
        <span className="font-mono">Transition {transition.id}</span>
      </div>
      <div className="grid gap-2 xl:grid-cols-4">
        <StageCard title="Observation" state={observationsState}>
          <ObservationRows label="Before" observations={transition.beforeObservations} />
          <ObservationRows label="After" observations={transition.afterObservations} />
        </StageCard>
        <StageCard title="Effect" state={effectState}>
          {transition.effectBundle ? (
            <>
              <p>Effect verdict: <span className="font-semibold text-foreground">{transition.effectBundle.verdict}</span></p>
              <p className="break-all font-mono text-[9px]">{transition.effectBundle.id}</p>
            </>
          ) : (
            <p>No effect bundle is linked to this transition.</p>
          )}
        </StageCard>
        <AcceptanceStage
          transition={transition}
          executionAttempt={executionAttempt}
          acceptance={acceptance}
          proofVerdict={proofVerdict}
        />
        <StageCard title="World materialization" state={worldState}>
          <p>Status: <span className="font-semibold text-foreground">{transition.status}</span></p>
          <p>Parent revision: <span className="break-all font-mono text-foreground/80">{transition.parentWorldRevision ?? "not recorded"}</span></p>
          <p>Result revision: <span className="break-all font-mono text-foreground/80">{transition.resultingWorldRevision ?? "not recorded"}</span></p>
          {transition.failureCode && <p>Failure code: <span className="font-mono text-foreground">{transition.failureCode}</span></p>}
        </StageCard>
      </div>
    </div>
  );
}

export default function WorldTransitionTimeline({
  recipeId,
  executionId,
  attempt,
  transitions = [],
  acceptance,
  proofVerdict,
  applyMission,
}: Props) {
  if (recipeId !== "runtime.start" && transitions.length === 0 && !applyMission) return null;

  const visibleTransitions = transitions.filter((transition) => (
    (!executionId || transition.executionId === executionId)
    && (typeof attempt !== "number" || transition.attempt === attempt)
  ));
  const handoffProven = applyMission?.d2.state === "PROVEN"
    && visibleTransitions.some((transition) => (
      transition.id === applyMission.d2.transitionId
      && transition.status === "materialized"
      && transition.resultingWorldRevision === applyMission.d2.resultingWorldRevision
    ));
  const handoffState = applyMission?.d2.state === "PROVEN" && !handoffProven
    ? "INCOMPLETE"
    : applyMission?.d2.state;

  return (
    <section className="rounded-xl border border-border bg-card" aria-label="World Transition timeline">
      <div className="border-b border-border/70 px-4 py-3.5">
        <h2 className="font-semibold">World Transition timeline</h2>
        <p className="mt-1 text-[11px] text-muted-foreground">
          Observation, effect, acceptance, and World materialization are separate records; one does not imply another.
        </p>
      </div>
      <div className="space-y-3 p-4">
        {visibleTransitions.length === 0 ? (
          <TransitionEntry
            executionAttempt={attempt}
            acceptance={acceptance}
            proofVerdict={proofVerdict}
          />
        ) : (
          visibleTransitions.map((transition) => (
            <TransitionEntry
              key={transition.id}
              transition={transition}
              executionAttempt={attempt}
              acceptance={acceptance}
              proofVerdict={proofVerdict}
            />
          ))
        )}
        {applyMission && (
          <div className="rounded-lg border border-border/70 bg-background/20 px-3 py-2 text-xs" aria-label="Apply Mission handoff" data-testid="status-apply-mission-handoff">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <span data-testid="status-apply-d2">
                Apply D2: <strong>{handoffState}</strong>
              </span>
              <span data-testid="status-report-goal">
                report-applied goal: <strong>{applyMission.successor?.status ?? "not linked"}</strong>
              </span>
            </div>
            {handoffProven && (
              <p className="mt-1 break-all font-mono text-[10px] text-muted-foreground">
                World revision: {applyMission.d2.resultingWorldRevision}
              </p>
            )}
            {applyMission.reason && (
              <p className="mt-1 text-muted-foreground">Binding reason: {applyMission.reason}</p>
            )}
            {applyMission.successor?.blockedReason && (
              <p className="mt-1 text-muted-foreground">Goal reason: {applyMission.successor.blockedReason}</p>
            )}
            <p className="mt-1 text-muted-foreground">
              {applyMission.successor?.status === "completed" && handoffProven
                ? "The report goal is complete. External delivery is not implied."
                : applyMission.successor
                  ? "The report goal is not verified complete; dispatch is not completion or external delivery."
                  : "No report goal can be linked to this active plan; external delivery is not implied."}
            </p>
          </div>
        )}
      </div>
    </section>
  );
}