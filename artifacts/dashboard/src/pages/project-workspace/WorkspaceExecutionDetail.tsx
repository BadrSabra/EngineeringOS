import { AlertTriangle, Loader2, RefreshCw } from "lucide-react";
import { useGetAiExecution } from "@workspace/api-client-react";
import { ExecutionProjectionPanel } from "@/components/ExecutionProjectionPanel";

type WorkspaceExecutionDetailProps = {
  executionId: string;
  projectId: string;
  attempt?: number;
  proposalId?: string | null;
};

function errorStatus(error: unknown): number | undefined {
  if (!error || typeof error !== "object" || !("status" in error)) return undefined;
  return typeof error.status === "number" ? error.status : undefined;
}

export default function WorkspaceExecutionDetail({
  executionId,
  projectId,
  attempt,
  proposalId,
}: WorkspaceExecutionDetailProps) {
  const query = useGetAiExecution(executionId, {
    query: {
      retry: false,
      refetchOnWindowFocus: true,
    },
  });

  if (query.isLoading) {
    return (
      <div className="mt-3 flex items-center gap-2 rounded-lg border border-border/50 bg-background/20 px-3 py-3 text-xs text-muted-foreground" role="status">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        جارٍ تحميل سجل التنفيذ والأدلة من المصدر المعتمد…
      </div>
    );
  }

  if (query.isError || !query.data) {
    const status = errorStatus(query.error);
    const message = status === 403
      ? "لا تملك صلاحية قراءة تفاصيل هذا التنفيذ."
      : status === 404
        ? "لم يعد التنفيذ متاحًا في هذه القراءة."
        : "تعذر تحميل تفاصيل التنفيذ. ملخص الحالة لا يكفي لتأكيد الأدلة.";

    return (
      <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-300/20 bg-amber-200/[.05] px-3 py-3 text-xs text-amber-100/85" role="status">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p>{message}</p>
          <button
            type="button"
            className="workspace-retry mt-2"
            onClick={() => void query.refetch()}
            disabled={query.isFetching}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${query.isFetching ? "animate-spin" : ""}`} />
            إعادة تحميل تفاصيل التنفيذ
          </button>
        </div>
      </div>
    );
  }

  const execution = query.data;
  const identityMismatch =
    execution.id !== executionId
    || Boolean(execution.projectId && execution.projectId !== projectId)
    || Boolean(
      attempt !== undefined
      && execution.attempt !== undefined
      && execution.attempt !== attempt
    )
    || Boolean(
      proposalId !== undefined
      && execution.proposalId !== undefined
      && (execution.proposalId ?? null) !== (proposalId ?? null)
    );

  if (identityMismatch || execution.projection?.schemaVersion !== 2) {
    return (
      <p className="mt-3 rounded-lg border border-amber-300/20 bg-amber-200/[.05] px-3 py-3 text-xs leading-5 text-amber-100/85" role="status">
        تعذر مطابقة تفاصيل التنفيذ مع المشروع أو المحاولة أو المرشح الحالي؛ لن نخلط بين إسقاطات مختلفة.
      </p>
    );
  }

  return (
    <ExecutionProjectionPanel
      projection={execution.projection}
      executionId={execution.id}
      executionStatus={execution.status}
      flightState={execution.flightState}
      evidenceVerdict={execution.evidenceVerdict}
      resumable={execution.resumable}
      proposalId={execution.proposalId}
      operationId={execution.operationId}
      compact
      readOnly
      hideRecoveryActions
    />
  );
}
