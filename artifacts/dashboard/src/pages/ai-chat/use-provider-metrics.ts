import { useState } from 'react';
import { exportAiMetrics, useGetAiMetrics } from '@workspace/api-client-react';
import { useToast } from '@/hooks/use-toast';
import {
  describeAiError,
  isProviderSendBlocked,
  type ActiveProvider,
  type MetricsProviderFilter,
  type MetricsResponse,
} from './provider-runtime';
import type { Project } from './types';

export function useProviderMetrics({
  selectedProjectId,
  projects,
  activeProvider,
  isLoaded,
}: {
  selectedProjectId: string;
  projects: Project[];
  activeProvider: ActiveProvider | undefined;
  isLoaded: boolean;
}) {
  const { toast } = useToast();
  const [metricsProvider, setMetricsProvider] = useState<MetricsProviderFilter>('all');
  const [metricsWindowDays, setMetricsWindowDays] = useState<number>(30);
  const [qualityExportPending, setQualityExportPending] = useState(false);

  // PR-06: poll runtime health metrics so provider cards show live state.
  // Durable model-quality usage is scoped to the project selected in the
  // sidebar and the operator's provider/window filters. The generated hook
  // includes these params in its query key, so changing any filter refetches
  // the corresponding aggregate without exposing raw AI content.
  const metricsParams = {
    projectId: selectedProjectId || undefined,
    provider: metricsProvider === 'all' ? undefined : metricsProvider,
    days: metricsWindowDays,
  } as const;
  const {
    data: metricsData,
    isLoading: metricsLoading,
    isFetching: metricsFetching,
    isError: metricsError,
    refetch: refetchMetrics,
  } = useGetAiMetrics<MetricsResponse>(metricsParams, {
    query: {
      queryKey: ['ai-metrics', metricsParams],
      staleTime: 15_000,
      refetchInterval: 30_000,
      enabled: isLoaded,
    },
  });
  const metricsMap = new Map(
    (metricsData?.metrics ?? []).map((m) => [m.provider, m]),
  );
  const activeProviderMetric = activeProvider?.provider
    ? metricsMap.get(activeProvider.provider)
    : undefined;
  const activeProviderSendBlocked = isProviderSendBlocked(activeProviderMetric);

  const exportQualityReport = async () => {
    setQualityExportPending(true);
    try {
      const report = await exportAiMetrics({
        projectId: selectedProjectId || undefined,
        provider: metricsProvider === 'all' ? undefined : metricsProvider,
        days: metricsWindowDays,
      });
      const blob = new Blob([`${JSON.stringify(report, null, 2)}\n`], {
        type: 'application/json;charset=utf-8',
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      const projectPart = (projects.find((project) => project.id === selectedProjectId)?.name ?? 'all-projects')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 48) || 'all-projects';
      const providerPart = metricsProvider === 'all' ? 'all-providers' : metricsProvider;
      anchor.href = url;
      anchor.download = `model-quality-${projectPart}-${providerPart}-${metricsWindowDays}d.json`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
      toast({
        title: 'صُدّر تقرير جودة الإجابات',
        description: 'التقرير التجميعي وفق المرشحات المحددة جاهز للمشاركة.',
      });
    } catch (error) {
      toast({
        title: 'تعذر تصدير تقرير الجودة',
        description: describeAiError(error),
        variant: 'destructive',
      });
    } finally {
      setQualityExportPending(false);
    }
  };

  return {
    metricsProvider,
    setMetricsProvider,
    metricsWindowDays,
    setMetricsWindowDays,
    qualityExportPending,
    metricsData,
    metricsLoading,
    metricsFetching,
    metricsError,
    activeProviderMetric,
    refetchMetrics,
    metricsMap,
    activeProviderSendBlocked,
    exportQualityReport,
  };
}
