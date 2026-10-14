import React, { useState } from 'react';
import {
  useListWorkflows,
  useListProjects,
  useCreateWorkflow,
  useStartWorkflow,
  useStopWorkflow,
  useAdvanceWorkflow,
  useFailWorkflowPhase,
  useRetryWorkflowPhase,
  useRollbackWorkflowPhase,
  useListWorkflowExecutions,
  useAiOrchestrateWorkflow,
  useDeleteWorkflow,
  getListWorkflowsQueryKey,
  getListWorkflowExecutionsQueryKey,
} from '@workspace/api-client-react';
import type { AiOrchestrationDecision } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import {
  GitMerge,
  Plus,
  Play,
  Square,
  Activity,
  CheckCircle2,
  ListTree,
  ChevronRight,
  RotateCcw,
  XCircle,
  History,
  ChevronDown,
  ChevronUp,
  X,
  Trash2,
  Sparkles,
} from 'lucide-react';
import { RefreshButton, RequestError } from '@/components/OperatorResilience';
import { ProviderRecoveryCard } from '@/components/ProviderRecoveryCard';

function workflowStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    idle: 'لم يبدأ',
    running: 'قيد التنفيذ',
    completed: 'انتهى بحسب السجل',
    failed: 'فشل مسجل',
    stopped: 'متوقف',
  };
  return labels[status] ?? status;
}

function orchestrationActionLabel(action: string): string {
  const labels: Record<string, string> = {
    advance: 'الانتقال إلى المرحلة التالية',
    wait: 'الانتظار',
    fail: 'تسجيل فشل المرحلة',
    complete: 'إنهاء المسار',
  };
  return labels[action] ?? action;
}

function CreateWorkflowModal({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const { data: projects } = useListProjects();
  const createWorkflow = useCreateWorkflow();

  type PhaseInput = { name: string; steps: string[]; condition?: string };

  const [projectId, setProjectId] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [phases, setPhases] = useState<PhaseInput[]>([
    { name: 'build', steps: [] },
    { name: 'test', steps: [] },
    { name: 'deploy', steps: [] },
  ]);

  const updatePhaseName = (idx: number, value: string) =>
    setPhases((prev) => prev.map((p, i) => (i === idx ? { ...p, name: value } : p)));

  const addPhaseStep = (phaseIdx: number) =>
    setPhases((prev) =>
      prev.map((p, i) => (i === phaseIdx ? { ...p, steps: [...p.steps, ''] } : p)),
    );

  const updatePhaseStep = (phaseIdx: number, stepIdx: number, value: string) =>
    setPhases((prev) =>
      prev.map((p, i) =>
        i === phaseIdx
          ? { ...p, steps: p.steps.map((s, j) => (j === stepIdx ? value : s)) }
          : p,
      ),
    );

  const removePhaseStep = (phaseIdx: number, stepIdx: number) =>
    setPhases((prev) =>
      prev.map((p, i) =>
        i === phaseIdx ? { ...p, steps: p.steps.filter((_, j) => j !== stepIdx) } : p,
      ),
    );

  const updatePhaseCondition = (idx: number, value: string) =>
    setPhases((prev) => prev.map((p, i) => (i === idx ? { ...p, condition: value } : p)));

  const addPhase = () => setPhases((prev) => [...prev, { name: '', steps: [] }]);
  const removePhase = (idx: number) => setPhases((prev) => prev.filter((_, i) => i !== idx));

  const cleanedPhases = phases
    .map((p) => ({
      name: p.name.trim(),
      steps: p.steps.map((s) => s.trim()).filter(Boolean),
      ...(p.condition?.trim() ? { condition: p.condition.trim() } : {}),
    }))
    .filter((p) => p.name);
  const canSubmit = !!projectId && name.trim().length > 0 && cleanedPhases.length > 0;

  const handleSubmit = () => {
    if (!canSubmit) return;
    createWorkflow.mutate(
      {
        data: {
          projectId,
          name: name.trim(),
          description: description.trim() || undefined,
          phases: cleanedPhases,
        },
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListWorkflowsQueryKey() });
          onClose();
        },
      },
    );
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div role="dialog" aria-modal="true" aria-labelledby="create-workflow-title" dir="rtl" lang="ar" className="bg-card border border-border rounded-xl shadow-xl w-full max-w-lg p-6 space-y-5">
        <div className="flex items-center justify-between">
          <h2 id="create-workflow-title" className="text-lg font-bold flex items-center gap-2">
            <GitMerge className="w-5 h-5 text-primary" /> إنشاء مسار عمل
          </h2>
          <button
            onClick={onClose}
            type="button"
            aria-label="إغلاق نافذة إنشاء مسار العمل"
            className="text-muted-foreground hover:text-foreground p-1 rounded hover:bg-secondary"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-3">
          <div>
            <label htmlFor="workflow-project" className="text-xs font-medium text-muted-foreground block mb-1">المشروع</label>
            <select
              id="workflow-project"
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              className="w-full bg-secondary/50 border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
            >
              <option value="">اختر مشروعًا…</option>
              {projects?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="workflow-name" className="text-xs font-medium text-muted-foreground block mb-1">اسم المسار</label>
            <input
              id="workflow-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="مثال: مسار الإصدار"
              dir="auto"
              className="w-full bg-secondary/50 border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>

          <div>
            <label htmlFor="workflow-description" className="text-xs font-medium text-muted-foreground block mb-1">
              الوصف (اختياري)
            </label>
            <input
              id="workflow-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="ما الذي ينظمه هذا المسار؟"
              dir="auto"
              className="w-full bg-secondary/50 border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">
              المراحل (تُنفذ بالترتيب)
            </label>
            <div className="space-y-2">
              {phases.map((phase, idx) => (
                <div key={idx} className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono text-muted-foreground w-5 text-center shrink-0">
                      {idx + 1}
                    </span>
                    <input
                      aria-label={`اسم المرحلة ${idx + 1}`}
                      value={phase.name}
                      onChange={(e) => updatePhaseName(idx, e.target.value)}
                      placeholder="اسم المرحلة"
                      dir="auto"
                      className="flex-1 bg-secondary/50 border border-border rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                    <button
                      type="button"
                      onClick={() => addPhaseStep(idx)}
                      className="text-muted-foreground hover:text-primary p-1 shrink-0"
                      title="إضافة خطوة إلى هذه المرحلة"
                      aria-label={`إضافة خطوة إلى المرحلة ${idx + 1}`}
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => removePhase(idx)}
                      disabled={phases.length <= 1}
                      className="text-muted-foreground hover:text-destructive disabled:opacity-30 p-1 shrink-0"
                      title="حذف المرحلة"
                      aria-label={`حذف المرحلة ${idx + 1}`}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  {phase.steps.map((step, stepIdx) => (
                    <div key={stepIdx} className="flex items-center gap-2 mr-7">
                      <input
                        aria-label={`وصف الخطوة ${stepIdx + 1} من المرحلة ${idx + 1}`}
                        value={step}
                        onChange={(e) => updatePhaseStep(idx, stepIdx, e.target.value)}
                        placeholder="وصف الخطوة أو أمر الطرفية"
                        dir="auto"
                        className="flex-1 bg-secondary/30 border border-border/60 rounded-md px-2.5 py-1 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-primary"
                      />
                      <button
                        type="button"
                        onClick={() => removePhaseStep(idx, stepIdx)}
                        className="text-muted-foreground hover:text-destructive p-1 shrink-0"
                        title="حذف الخطوة"
                        aria-label={`حذف الخطوة ${stepIdx + 1} من المرحلة ${idx + 1}`}
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                  {/* PR-D: optional advance condition per phase */}
                  <div className="ml-7 mt-1">
                    <input
                      aria-label={`شرط الانتقال للمرحلة ${idx + 1}`}
                      value={phase.condition ?? ''}
                      onChange={(e) => updatePhaseCondition(idx, e.target.value)}
                      placeholder="شرط الانتقال (اختياري) — مثال: qualityScore >= 80"
                      title="شرط JavaScript يُقيّم قبل تجاوز المرحلة. المتغيرات المتاحة: qualityScore وcurrentPhase وcompletedPhases"
                      dir="auto"
                      className="w-full bg-secondary/20 border border-border/40 rounded-md px-2.5 py-1 text-xs font-mono text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary placeholder:italic"
                    />
                  </div>
                </div>
              ))}
            </div>
            <button
              onClick={addPhase}
              className="mt-2 text-xs text-primary hover:underline flex items-center gap-1"
            >
              <Plus className="w-3 h-3" /> إضافة مرحلة
            </button>
          </div>
        </div>

        {createWorkflow.isError && (
          <p className="text-xs text-destructive" role="alert">تعذر إنشاء مسار العمل. حاول مرة أخرى.</p>
        )}

        <div className="flex justify-end gap-2 pt-2 border-t border-border">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-md font-medium text-sm text-muted-foreground hover:bg-secondary transition-colors"
          >
            إلغاء
          </button>
          <button
            onClick={handleSubmit}
            disabled={!canSubmit || createWorkflow.isPending}
            className="bg-primary hover:bg-primary/90 text-primary-foreground px-4 py-2 rounded-md font-medium text-sm disabled:opacity-50 transition-colors"
          >
            {createWorkflow.isPending ? 'جارٍ الإنشاء…' : 'إنشاء المسار'}
          </button>
        </div>
      </div>
    </div>
  );
}

function ExecutionHistory({
  workflowId,
  phases,
}: {
  workflowId: string;
  phases: Array<{ name: string }>;
}) {
  const { data: executions, isLoading, isError, error, refetch } = useListWorkflowExecutions(workflowId, {
    query: { queryKey: getListWorkflowExecutionsQueryKey(workflowId), staleTime: 10_000 },
  });
  const queryClient = useQueryClient();
  const retryPhase = useRetryWorkflowPhase();
  const rollbackPhase = useRollbackWorkflowPhase();

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: getListWorkflowExecutionsQueryKey(workflowId) });
    queryClient.invalidateQueries({ queryKey: getListWorkflowsQueryKey() });
  };

  if (isLoading) {
    return <div dir="rtl" className="text-xs text-muted-foreground animate-pulse py-2">جارٍ تحميل سجلات التشغيل…</div>;
  }
  if (isError) {
    return <RequestError message={error instanceof Error ? error.message : 'تعذر تحميل سجلات التشغيل.'} onRetry={() => void refetch()} />;
  }
  if (!executions || executions.length === 0) {
    return <p dir="rtl" className="text-xs text-muted-foreground italic py-2">لا توجد تشغيلات مسجلة بعد.</p>;
  }

  const statusStyle = (status: string) =>
    status === 'running'
      ? 'text-primary'
      : status === 'completed'
      ? 'text-emerald-500'
      : status === 'failed'
      ? 'text-destructive'
      : status === 'stopped'
      ? 'text-amber-500'
      : 'text-muted-foreground';

  type ExecutionWithRecovery = (typeof executions)[number] & {
    recovery?: Record<string, unknown>;
    recoverySummary?: Record<string, unknown>;
  };

  return (
    <div className="space-y-2">
      {executions.map((exec) => (
        <div
          key={exec.id}
          className="flex items-center justify-between text-xs bg-secondary/30 rounded-lg px-3 py-2 gap-3"
        >
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className={`font-bold ${statusStyle(exec.status)}`}>
                {exec.status === 'completed'
                  ? 'انتهى التشغيل · أكّد الخادم النجاح'
                  : exec.status === 'failed'
                    ? 'فشل التشغيل · لم يُسجل اكتماله بنجاح'
                    : exec.status === 'stopped'
                      ? 'توقف التشغيل · لم يكتمل'
                      : workflowStatusLabel(exec.status)}
              </span>
              {exec.currentPhase && (
                <span dir="ltr" className="text-muted-foreground font-mono truncate">
                  @ <bdi>{exec.currentPhase}</bdi>
                </span>
              )}
            </div>
            {exec.completedPhases && exec.completedPhases.length > 0 && (
              <div className="text-[10px] text-muted-foreground mt-1 truncate">
                مراحل مكتملة: <bdi dir="ltr" className="font-mono">{exec.completedPhases.join(' → ')}</bdi>
              </div>
            )}
            {exec.errorMessage && (
              <div dir="rtl" className="text-[10px] text-destructive mt-1 truncate" title="فشل تشغيل مسار العمل">
                لم يكتمل تشغيل مسار العمل.
              </div>
            )}
            {(() => {
              const execution = exec as ExecutionWithRecovery;
              const recovery = execution.recovery ?? execution.recoverySummary
                ?? (exec.errorMessage ? { availabilityState: 'unknown' } : null);
              return <ProviderRecoveryCard recovery={recovery} className="mt-2" />;
            })()}
          </div>
          <div dir="ltr" className="text-[10px] text-muted-foreground font-mono shrink-0">
            {new Date(exec.startedAt).toLocaleString('ar-EG')}
          </div>
          {exec.status === 'failed' && (
            <button
              onClick={() =>
                retryPhase.mutate(
                  { workflowId, executionId: exec.id },
                  { onSuccess: invalidate },
                )
              }
              disabled={retryPhase.isPending}
              className="shrink-0 flex items-center gap-1 text-primary hover:underline disabled:opacity-50"
            >
              <RotateCcw className="w-3 h-3" /> إعادة المحاولة
            </button>
          )}
          {['running', 'failed', 'completed'].includes(exec.status) &&
            (() => {
              const currentIndex = exec.currentPhase
                ? phases.findIndex((phase) => phase.name === exec.currentPhase)
                : exec.status === 'completed'
                ? phases.length
                : -1;
              const rollbackTargets = (exec.completedPhases ?? []).filter((phaseName) => {
                const phaseIndex = phases.findIndex((phase) => phase.name === phaseName);
                return phaseIndex >= 0 && phaseIndex < currentIndex;
              });
              if (rollbackTargets.length === 0) return null;
              return (
                <div className="flex items-center gap-1.5 shrink-0">
                  {rollbackTargets.map((targetPhase) => (
                    <button
                      key={targetPhase}
                      onClick={() => {
                        if (
                          window.confirm(
                            `إعادة هذا التشغيل إلى المرحلة "${targetPhase}"؟ ستحتاج المراحل اللاحقة المكتملة إلى التنفيذ مجددًا.`,
                          )
                        ) {
                          rollbackPhase.mutate(
                            { workflowId, executionId: exec.id, data: { targetPhase } },
                            { onSuccess: invalidate },
                          );
                        }
                      }}
                      disabled={rollbackPhase.isPending}
                      className="flex items-center gap-1 text-amber-500 hover:underline disabled:opacity-50"
                      title={`إعادة التنفيذ من المرحلة ${targetPhase}`}
                      aria-label={`إعادة التشغيل من المرحلة ${targetPhase}`}
                    >
                      <RotateCcw className="w-3 h-3" /> {targetPhase}
                    </button>
                  ))}
                </div>
              );
            })()}
        </div>
      ))}
    </div>
  );
}

export default function Workflows() {
  const queryClient = useQueryClient();
  const { data: workflows, isLoading, isError, error, refetch, isRefetching, dataUpdatedAt } = useListWorkflows({});
  const [expandedId, setExpandedId] = useState<string>('');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [orchestrationState, setOrchestrationState] = useState<
    | { workflowId: string; status: 'loading' }
    | { workflowId: string; status: 'success'; decision: AiOrchestrationDecision }
    | { workflowId: string; status: 'error'; message: string }
    | null
  >(null);
  const [deleteErrors, setDeleteErrors] = useState<Record<string, string>>({});

  const startWorkflow = useStartWorkflow();
  const stopWorkflow = useStopWorkflow();
  const advanceWorkflow = useAdvanceWorkflow();
  const failPhase = useFailWorkflowPhase();
  const orchestrateWorkflow = useAiOrchestrateWorkflow();
  const deleteWorkflow = useDeleteWorkflow();

  const invalidateWorkflow = (workflowId: string) => {
    queryClient.invalidateQueries({ queryKey: getListWorkflowsQueryKey() });
    queryClient.invalidateQueries({ queryKey: getListWorkflowExecutionsQueryKey(workflowId) });
  };

  const handleToggle = (workflowId: string, status: string) => {
    const isRunning = status === 'running';
    const mutation = isRunning ? stopWorkflow : startWorkflow;
    mutation.mutate(
      { workflowId },
      { onSuccess: () => invalidateWorkflow(workflowId) },
    );
  };

  const handleAdvance = (workflowId: string) => {
    advanceWorkflow.mutate({ workflowId }, { onSuccess: () => invalidateWorkflow(workflowId) });
  };

  const handleFailPhase = (workflowId: string) => {
    failPhase.mutate(
      { workflowId, data: { error: 'Manually marked as failed by operator' } },
      { onSuccess: () => invalidateWorkflow(workflowId) },
    );
  };

  const handleOrchestrate = (workflowId: string) => {
    setOrchestrationState({ workflowId, status: 'loading' });
    orchestrateWorkflow.mutate(
      { workflowId, data: {} },
      {
        onSuccess: (decision) => setOrchestrationState({ workflowId, status: 'success', decision }),
        onError: (requestError) => setOrchestrationState({
          workflowId,
          status: 'error',
          message: requestError instanceof Error ? requestError.message : 'Unable to get an AI suggestion.',
        }),
      },
    );
  };

  const handleDelete = (workflowId: string, workflowName: string) => {
    const confirmed = window.confirm(
      `حذف «${workflowName}»؟ سيؤدي ذلك أيضًا إلى حذف سجل تشغيل المسار نهائيًا.`,
    );
    if (!confirmed) return;

    setDeleteErrors((previous) => {
      const next = { ...previous };
      delete next[workflowId];
      return next;
    });
    deleteWorkflow.mutate(
      { workflowId },
      {
        onSuccess: () => {
          void queryClient.invalidateQueries({ queryKey: getListWorkflowsQueryKey() });
          queryClient.removeQueries({ queryKey: getListWorkflowExecutionsQueryKey(workflowId) });
          setExpandedId((current) => current === workflowId ? '' : current);
          setOrchestrationState((current) => current?.workflowId === workflowId ? null : current);
        },
        onError: (requestError) => {
          setDeleteErrors((previous) => ({
            ...previous,
            [workflowId]: requestError instanceof Error ? requestError.message : 'تعذر حذف مسار العمل.',
          }));
        },
      },
    );
  };

  return (
    <div className="space-y-6" dir="rtl" lang="ar">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <GitMerge className="w-6 h-6 text-primary" /> مسارات العمل
          </h1>
          <p className="text-muted-foreground text-sm mt-1">تنفيذ مهام المشروع عبر مراحل متتابعة.</p>
        </div>
          <RefreshButton onRefresh={refetch} isRefreshing={isRefetching} lastUpdated={dataUpdatedAt} label="تحديث مسارات العمل" />
          <button
          onClick={() => setShowCreateModal(true)}
          className="bg-primary hover:bg-primary/90 text-primary-foreground px-4 py-2 rounded-md font-medium text-sm flex items-center gap-2 shadow-sm transition-colors"
        >
          <Plus className="w-4 h-4" /> مسار عمل جديد
        </button>
      </div>

      {showCreateModal && <CreateWorkflowModal onClose={() => setShowCreateModal(false)} />}

      <div className="grid grid-cols-1 gap-6">
        {isLoading ? (
          <div className="h-64 bg-card border border-border rounded-xl animate-pulse"></div>
        ) : isError ? (
          <RequestError message={error instanceof Error ? error.message : 'تعذر تحميل مسارات العمل.'} onRetry={() => void refetch()} />
        ) : workflows?.length === 0 ? (
          <div className="border-2 border-dashed border-border rounded-xl p-16 text-center flex flex-col items-center">
            <ListTree className="w-12 h-12 text-muted-foreground mb-4 opacity-50" />
            <h3 className="text-lg font-semibold mb-2">لا توجد مسارات عمل بعد</h3>
            <p className="text-muted-foreground text-sm max-w-sm mb-6">
              أنشئ مسارًا لتنسيق خطوات العمل تلقائيًا عبر عدة مراحل.
            </p>
            <button
              onClick={() => setShowCreateModal(true)}
              className="bg-primary hover:bg-primary/90 text-primary-foreground px-4 py-2 rounded-md font-medium text-sm flex items-center gap-2 shadow-sm transition-colors"
            >
              <Plus className="w-4 h-4" /> مسار عمل جديد
            </button>
          </div>
        ) : (
          workflows?.map((workflow) => (
            <div
              key={workflow.id}
              className="bg-card border border-border rounded-xl p-6 shadow-sm"
            >
              <div className="flex justify-between items-start mb-6">
                <div>
                  <div className="flex items-center gap-3">
                    <h2 dir="auto" className="text-xl font-bold">{workflow.name}</h2>
                    <span
                      className={`px-2 py-0.5 rounded text-xs font-bold uppercase tracking-wider border
                      ${
                        workflow.status === 'running'
                          ? 'bg-primary/10 text-primary border-primary/20'
                          : workflow.status === 'completed'
                          ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20'
                          : 'bg-secondary text-muted-foreground border-border'
                      }`}
                    >
                      {workflow.status === 'running' ? (
                        <Activity className="w-3 h-3 inline mr-1 animate-pulse" />
                      ) : null}
                      {workflowStatusLabel(workflow.status)}
                    </span>
                  </div>
                  <p dir="auto" className="text-muted-foreground text-sm mt-1">{workflow.description}</p>
                </div>
                <div className="flex gap-2">
                  {workflow.status === 'running' && (
                    <>
                      <button
                        onClick={() => handleAdvance(workflow.id)}
                        disabled={advanceWorkflow.isPending}
                        className="px-3 py-2 rounded-md font-medium text-sm flex items-center gap-1.5 shadow-sm transition-colors disabled:opacity-50 bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500 hover:text-white border border-emerald-500/20"
                        title="الانتقال إلى المرحلة التالية"
                        aria-label="الانتقال إلى المرحلة التالية"
                      >
                        <ChevronRight className="w-4 h-4" /> انتقال للمرحلة التالية
                      </button>
                      <button
                        onClick={() => handleFailPhase(workflow.id)}
                        disabled={failPhase.isPending}
                        title="تسجيل فشل المرحلة الحالية"
                        aria-label="تسجيل فشل المرحلة الحالية"
                        className="px-3 py-2 rounded-md font-medium text-sm flex items-center gap-1.5 shadow-sm transition-colors disabled:opacity-50 bg-secondary text-muted-foreground hover:bg-destructive hover:text-destructive-foreground"
                        title="Mark current phase as failed"
                      >
                        <XCircle className="w-4 h-4" />
                      </button>
                    </>
                  )}
                  <button
                    onClick={() => handleToggle(workflow.id, workflow.status)}
                    disabled={startWorkflow.isPending || stopWorkflow.isPending}
                    className={`px-4 py-2 rounded-md font-medium text-sm flex items-center gap-2 shadow-sm transition-colors disabled:opacity-50
                      ${
                        workflow.status === 'running'
                          ? 'bg-destructive/10 text-destructive hover:bg-destructive hover:text-destructive-foreground border border-destructive/20'
                          : 'bg-primary text-primary-foreground hover:bg-primary/90'
                      }`}
                  >
                    {workflow.status === 'running' ? (
                      <>
                        <Square className="w-4 h-4" fill="currentColor" /> إيقاف
                      </>
                    ) : (
                      <>
                        <Play className="w-4 h-4" /> تشغيل
                      </>
                    )}
                  </button>
                </div>
              </div>

              <div className="mb-5 flex flex-wrap items-center gap-2">
                <button
                  onClick={() => handleOrchestrate(workflow.id)}
                  disabled={orchestrateWorkflow.isPending}
                  className="px-3 py-2 rounded-md font-medium text-sm flex items-center gap-2 border border-primary/30 bg-primary/5 text-primary hover:bg-primary/10 disabled:opacity-50"
                  title="احصل على مقترح من المساعد دون تغيير حالة مسار العمل"
                >
                  <Sparkles className="w-4 h-4" />
                  {orchestrationState?.workflowId === workflow.id && orchestrationState.status === 'loading'
                    ? 'جارٍ التحليل…'
                    : 'اطلب مقترحًا'}
                </button>
                <button
                  onClick={() => handleDelete(workflow.id, workflow.name)}
                  disabled={workflow.status === 'running' || deleteWorkflow.isPending}
                  className="px-3 py-2 rounded-md font-medium text-sm flex items-center gap-2 border border-destructive/25 text-destructive hover:bg-destructive/10 disabled:opacity-50 disabled:cursor-not-allowed"
                  title={workflow.status === 'running' ? 'أوقف مسار العمل قبل حذفه' : 'حذف مسار العمل وسجل تشغيله'}
                >
                  <Trash2 className="w-4 h-4" /> حذف
                </button>
                {workflow.status === 'running' && (
                  <span className="text-xs text-muted-foreground">أوقف مسار العمل قبل حذفه.</span>
                )}
              </div>

              {deleteErrors[workflow.id] && (
                <p dir="auto" className="mb-4 text-sm text-destructive" role="alert">{deleteErrors[workflow.id]}</p>
              )}

              {orchestrationState?.workflowId === workflow.id && orchestrationState.status === 'error' && (
                <p dir="auto" className="mb-4 text-sm text-destructive" role="alert">{orchestrationState.message}</p>
              )}
              {orchestrationState?.workflowId === workflow.id && orchestrationState.status === 'success' && (
                <section className="mb-5 rounded-lg border border-primary/20 bg-primary/5 p-4" aria-label="مقترح مسار العمل" dir="rtl">
                  <div className="flex flex-wrap items-center gap-2">
                    <Sparkles className="h-4 w-4 text-primary" />
                    <h3 className="font-semibold text-sm">
                      مقترح المساعد: {orchestrationActionLabel(orchestrationState.decision.action)}
                    </h3>
                    {orchestrationState.decision.nextPhase && (
                      <span className="rounded bg-background px-2 py-0.5 text-xs text-muted-foreground">
                        المرحلة التالية: <bdi dir="auto">{orchestrationState.decision.nextPhase}</bdi>
                      </span>
                    )}
                  </div>
                  <p dir="auto" className="mt-2 text-sm text-muted-foreground">{orchestrationState.decision.reasoning}</p>
                  {orchestrationState.decision.blockers && orchestrationState.decision.blockers.length > 0 && (
                    <div className="mt-3">
                      <h4 className="text-xs font-semibold tracking-wide text-muted-foreground">ما يعيق التقدم</h4>
                      <ul className="mt-1 list-disc pl-5 text-sm">
                        {orchestrationState.decision.blockers.map((blocker, index) => <li dir="auto" key={`${index}-${blocker}`}>{blocker}</li>)}
                      </ul>
                    </div>
                  )}
                  {orchestrationState.decision.suggestions && orchestrationState.decision.suggestions.length > 0 && (
                    <div className="mt-3">
                      <h4 className="text-xs font-semibold tracking-wide text-muted-foreground">مقترحات</h4>
                      <ul className="mt-1 list-disc pl-5 text-sm">
                        {orchestrationState.decision.suggestions.map((suggestion, index) => <li dir="auto" key={`${index}-${suggestion}`}>{suggestion}</li>)}
                      </ul>
                    </div>
                  )}
                  <p className="mt-3 text-xs text-muted-foreground">
                    هذا مقترح فقط؛ لا يقدّم المسار ولا يسجّل فشله أو اكتماله.
                  </p>
                </section>
              )}

              {/* Phase timeline */}
              {workflow.phases && workflow.phases.length > 0 && (() => {
                const totalPhases = workflow.phases.length;
                const currentPhaseIdx = workflow.currentPhase
                  ? workflow.phases.findIndex((p) => p.name === workflow.currentPhase)
                  : -1;
                const completedCount =
                  workflow.status === 'completed'
                    ? totalPhases
                    : currentPhaseIdx >= 0
                    ? currentPhaseIdx
                    : 0;
                const progressPct =
                  totalPhases > 0 ? (completedCount / totalPhases) * 100 : 0;
                return (
                <div className="relative">
                    <div className="absolute top-1/2 right-0 w-full h-0.5 bg-secondary -translate-y-1/2 z-0"></div>
                  {(workflow.status === 'running' || workflow.status === 'completed') && (
                    <div
                      className={`absolute top-1/2 right-0 h-0.5 bg-primary -translate-y-1/2 z-0 transition-all duration-500${workflow.status === 'running' ? ' animate-pulse' : ''}`}
                      style={{ width: `${progressPct}%` }}
                    ></div>
                  )}
                  <div className="flex items-center justify-between relative z-10">
                    {workflow.phases.map((phase, idx) => {
                      const isCurrent = workflow.currentPhase === phase.name;
                      const isPast = workflow.currentPhase
                        ? workflow.phases.findIndex((p) => p.name === workflow.currentPhase) > idx
                        : false;
                      const isCompleted = workflow.status === 'completed' || isPast;
                      return (
                        <div key={idx} className="flex flex-col items-center bg-card px-2">
                          <div
                            className={`w-8 h-8 rounded-full flex items-center justify-center border-2 mb-2
                            ${
                              isCompleted
                                ? 'bg-emerald-500 border-emerald-500 text-white'
                                : isCurrent
                                ? 'bg-primary/20 border-primary text-primary shadow-[0_0_15px_rgba(0,165,255,0.5)]'
                                : 'bg-secondary border-border text-muted-foreground'
                            }`}
                          >
                            {isCompleted ? (
                              <CheckCircle2 className="w-4 h-4" />
                            ) : (
                              <span className="font-mono text-sm">{idx + 1}</span>
                            )}
                          </div>
                          <span
                            className={`text-xs font-bold uppercase tracking-wider ${
                              isCurrent
                                ? 'text-primary'
                                : isCompleted
                                ? 'text-foreground'
                                : 'text-muted-foreground'
                            }`}
                          >
                            <bdi dir="auto">{phase.name}</bdi>
                          </span>
                          <span className="text-[10px] text-muted-foreground mt-1">
                            عدد الخطوات: {phase.steps.length}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
              })()}

              <div className="mt-8 bg-secondary/30 rounded-lg p-4 text-xs font-mono text-muted-foreground flex justify-between items-center">
                <span>
                  مرات التشغيل:{' '}
                  <span className="text-foreground font-bold">{workflow.executionCount || 0}</span>
                </span>
                <span>المعرّف: <bdi dir="ltr">{workflow.id}</bdi></span>
                <span>معرّف المشروع: <bdi dir="ltr">{workflow.projectId}</bdi></span>
              </div>

              <button
                onClick={() => setExpandedId(expandedId === workflow.id ? '' : workflow.id)}
                className="mt-4 w-full flex items-center justify-between text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors border-t border-border pt-4"
              >
                <span className="flex items-center gap-1.5">
                  <History className="w-3.5 h-3.5" /> سجل التشغيل
                </span>
                {expandedId === workflow.id ? (
                  <ChevronUp className="w-4 h-4" />
                ) : (
                  <ChevronDown className="w-4 h-4" />
                )}
              </button>
              {expandedId === workflow.id && (
                <div className="mt-3">
                   <ExecutionHistory workflowId={workflow.id} phases={workflow.phases} />
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
