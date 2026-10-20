import type { EngineeringAgentProjection } from '@/lib/ai-missions';
import { getMissionState } from './mission-state';

export function MissionAgentProjectionSummary({
  projection,
  compact = false,
}: {
  projection: EngineeringAgentProjection;
  compact?: boolean;
}) {
  const state = getMissionState(projection);
  const tone = state.key === 'COMPLETE'
    ? 'border-emerald-400/25 bg-emerald-300/[0.06]'
    : state.key === 'NEEDS_ATTENTION'
      || state.key === 'AWAITING_APPROVAL'
      || state.key === 'DELIVERING'
      ? 'border-amber-300/25 bg-amber-300/[0.06]'
      : 'border-cyan-300/20 bg-cyan-300/[0.04]';

  return (
    <section
      className={`rounded-lg border ${tone} ${compact ? 'p-3' : 'p-3.5'}`}
      dir="rtl"
      lang="ar"
      role="status"
      aria-label="حالة الوكيل الهندسي"
      data-testid={`mission-agent-state-${projection.missionId}`}
      data-state={state.key}
      data-action={state.nextAction}
      data-reason-code={state.reasonCode}
    >
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <h3
          className="text-sm font-semibold text-foreground"
          data-testid={`mission-agent-state-label-${projection.missionId}`}
        >
          {state.label}
        </h3>
        <span
          className="text-[11px] font-medium text-muted-foreground"
          data-testid={`mission-agent-next-action-${projection.missionId}`}
        >
          الخطوة التالية: {state.nextActionLabel}
        </span>
      </div>
      <p className={`mt-1.5 leading-5 text-muted-foreground ${compact ? 'text-[11px]' : 'text-xs'}`}>
        {state.detail}
      </p>
      <p
        className="mt-1 text-[10px] text-muted-foreground/80"
        data-testid={`mission-agent-intervention-${projection.missionId}`}
      >
        {state.interventionLabel}
      </p>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-muted-foreground/80">
        <span data-testid={`mission-agent-autonomy-${projection.missionId}`}>
          وضع التشغيل: {projection.autonomy.mode === 'autonomous' ? 'مستقل' : 'مساعد'}
        </span>
        {projection.autonomy.requireHumanForExternalDelivery && (
          <span data-testid={`mission-agent-delivery-policy-${projection.missionId}`}>
            التسليم الخارجي يتطلب مراجعة بشرية
          </span>
        )}
      </div>
    </section>
  );
}
