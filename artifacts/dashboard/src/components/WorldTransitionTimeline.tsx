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
          <bdi dir="ltr">{stateLabel[state]}</bdi>
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
        <span className="font-medium text-foreground/80">{label}:</span> لا توجد مراجع مرتبطة بالانتقال.
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <div className="font-medium text-foreground/80">{label}</div>
      {observations.map((observation) => (
        <div key={observation.id} className="rounded-md border border-border/45 bg-background/30 px-2 py-1.5">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <bdi dir="ltr">{observation.predicate}</bdi>
        <bdi dir="ltr" className="text-foreground">
              {observation.predicate === "workspace.tree_hash"
                ? "قيمة تجزئة الشجرة غير معروضة"
                : observation.runtimeStatus ?? "لم يُتحقق من الحالة بصورة مستقلة"}
        </bdi>
          </div>
          <div dir="ltr" className="break-all font-mono text-[9px] opacity-80">{observation.id}</div>
          <div>
            <bdi dir="ltr">{observation.provenance} · {observation.completeness} · {observation.freshness} · environment {observation.environmentFreshness}</bdi>
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
    <StageCard title="القبول" state={state}>
      {!acceptance ? (
        <p>لا توجد لقطة قبول مسجلة لهذه المحاولة.</p>
      ) : (
        <>
          <p>
            {isSameAttempt ? `المحاولة ${acceptance.attempt}` : `محاولة القبول ${acceptance.attempt} لا تطابق هذا الانتقال`}
            {" · "}
            <bdi dir="ltr">{acceptance.outcome}</bdi>
          </p>
          <p>
            {isProven
              ? "قبول الخادم والإثبات المعتمد كلاهما PROVEN."
              : <>اكتملت الأدلة: {acceptance.evidenceComplete ? "نعم" : "لا"} · الإثبات المعتمد: {proofVerdict ? <bdi dir="ltr">{proofVerdict}</bdi> : "لم يثبت"}</>}
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
        <StageCard title="الرصد" state="missing">
          <p>لم تُعَد أرصاد قبل/بعد مرتبطة بالانتقال.</p>
        </StageCard>
        <StageCard title="الأثر" state="missing">
          <p>لم تُعَد حزمة أثر مرتبطة بالانتقال.</p>
        </StageCard>
        <AcceptanceStage
          executionAttempt={executionAttempt}
          acceptance={acceptance}
          proofVerdict={proofVerdict}
        />
        <StageCard title="تحديث حالة العالم" state="missing">
          <p>لا يوجد سجل انتقال حالة عالم لهذه المحاولة.</p>
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
        <span className="font-mono"><bdi dir="ltr">Episode {transition.episodeId}</bdi></span>
        <span className="font-mono"><bdi dir="ltr">Action {transition.actionId}</bdi></span>
        <span className="font-mono"><bdi dir="ltr">Attempt {transition.attempt}</bdi></span>
        <span className="font-mono"><bdi dir="ltr">Transition {transition.id}</bdi></span>
      </div>
      <div className="grid gap-2 xl:grid-cols-4">
        <StageCard title="الرصد" state={observationsState}>
          <ObservationRows label="قبل" observations={transition.beforeObservations} />
          <ObservationRows label="بعد" observations={transition.afterObservations} />
        </StageCard>
        <StageCard title="الأثر" state={effectState}>
          {transition.effectBundle ? (
            <>
              <p>حكم الأثر: <bdi dir="ltr" className="font-semibold text-foreground">{transition.effectBundle.verdict}</bdi></p>
              <p dir="ltr" className="break-all font-mono text-[9px]">{transition.effectBundle.id}</p>
            </>
          ) : (
            <p>لا توجد حزمة أثر مرتبطة بهذا الانتقال.</p>
          )}
        </StageCard>
        <AcceptanceStage
          transition={transition}
          executionAttempt={executionAttempt}
          acceptance={acceptance}
          proofVerdict={proofVerdict}
        />
        <StageCard title="تحديث حالة العالم" state={worldState}>
          <p>الحالة: <bdi dir="ltr" className="font-semibold text-foreground">{transition.status}</bdi></p>
          <p>مراجعة الحالة السابقة: {transition.parentWorldRevision ? <bdi dir="ltr" className="break-all font-mono text-foreground/80">{transition.parentWorldRevision}</bdi> : "غير مسجلة"}</p>
          <p>مراجعة الحالة الناتجة: {transition.resultingWorldRevision ? <bdi dir="ltr" className="break-all font-mono text-foreground/80">{transition.resultingWorldRevision}</bdi> : "غير مسجلة"}</p>
          {transition.failureCode && <p>رمز الإخفاق: <bdi dir="ltr" className="font-mono text-foreground">{transition.failureCode}</bdi></p>}
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
    <section className="rounded-xl border border-border bg-card" aria-label="الخط الزمني لانتقال حالة العالم">
      <div className="border-b border-border/70 px-4 py-3.5">
        <h2 className="font-semibold">الخط الزمني لانتقال حالة العالم</h2>
        <p className="mt-1 text-[11px] text-muted-foreground">
          الرصد والأثر والقبول وتحديث حالة العالم سجلات منفصلة؛ ولا يثبت أحدها تحقق الآخر.
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
          <div className="rounded-lg border border-border/70 bg-background/20 px-3 py-2 text-xs" aria-label="إحالة تطبيق الخطة" data-testid="status-apply-mission-handoff">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <span data-testid="status-apply-d2">
                إثبات التطبيق D2: <bdi dir="ltr"><strong>{handoffState}</strong></bdi>
              </span>
              <span data-testid="status-report-goal">
                هدف التقرير الناتج عن التطبيق: {applyMission.successor?.status ? <bdi dir="ltr"><strong>{applyMission.successor.status}</strong></bdi> : "غير مرتبط"}
              </span>
            </div>
            {handoffProven && (
              <p className="mt-1 break-all font-mono text-[10px] text-muted-foreground">
                مراجعة حالة العالم: <bdi dir="ltr">{applyMission.d2.resultingWorldRevision}</bdi>
              </p>
            )}
            {applyMission.reason && (
              <p className="mt-1 text-muted-foreground">سبب الربط: <bdi dir="ltr">{applyMission.reason}</bdi></p>
            )}
            {applyMission.successor?.blockedReason && (
              <p className="mt-1 text-muted-foreground">سبب تعذر الهدف: <bdi dir="ltr">{applyMission.successor.blockedReason}</bdi></p>
            )}
            <p className="mt-1 text-muted-foreground">
              {applyMission.successor?.status === "completed" && handoffProven
                ? "اكتمل هدف التقرير. ولا يعني ذلك تسليمًا خارجيًا."
                : applyMission.successor
                  ? "لم يُتحقق من اكتمال هدف التقرير؛ فالإرسال لا يعني اكتمالًا أو تسليمًا خارجيًا."
                  : "لا يمكن ربط هدف تقرير بهذه الخطة النشطة؛ ولا يعني ذلك تسليمًا خارجيًا."}
            </p>
          </div>
        )}
      </div>
    </section>
  );
}