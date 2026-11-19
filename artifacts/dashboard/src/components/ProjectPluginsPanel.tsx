import { useState } from "react";
import {
  getListProjectPluginsQueryKey,
  useListProjectPlugins,
  useUpdateProjectPluginBinding,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";

interface ProjectPluginsPanelProps {
  projectId: string;
}

export default function ProjectPluginsPanel({
  projectId,
}: ProjectPluginsPanelProps) {
  const queryClient = useQueryClient();
  const pluginsQuery = useListProjectPlugins(projectId, {
    query: {
      enabled: Boolean(projectId),
      queryKey: getListProjectPluginsQueryKey(projectId),
      staleTime: 15_000,
      refetchOnWindowFocus: true,
    },
  });
  const updateBinding = useUpdateProjectPluginBinding();
  const [error, setError] = useState<string | null>(null);
  const plugins = pluginsQuery.data ?? [];
  const canEnablePlugin = (plugin: (typeof plugins)[number]) =>
    plugin.available && plugin.scanHookImplemented && plugin.compatibleWithProject;
  const visiblePlugins = plugins.filter((plugin) => plugin.projectEnabled || canEnablePlugin(plugin));
  const deferredPlugins = plugins.filter((plugin) => !plugin.projectEnabled && !canEnablePlugin(plugin));

  const setProjectActivation = (pluginId: string, enabled: boolean) => {
    setError(null);
    updateBinding.mutate(
      { projectId, pluginId, data: { enabled } },
      {
        onSuccess: () => {
          void queryClient.invalidateQueries({
            queryKey: getListProjectPluginsQueryKey(projectId),
          });
        },
        onError: (mutationError) => {
          setError(
            mutationError instanceof Error
              ? mutationError.message
              : "تعذّر تحديث تفعيل الإضافة لهذا المشروع.",
          );
        },
      },
    );
  };

  const renderPlugin = (plugin: (typeof plugins)[number]) => {
    const state = plugin.effectiveForProjectScan
      ? "مفعّلة لفحوص هذا المشروع"
      : !plugin.scanHookImplemented
        ? "لا يتوفر فحص لهذه الإضافة"
      : !plugin.compatibleWithProject
        ? "لا تتوافق مع لغة المشروع"
      : plugin.projectEnabled
        ? "مفعّلة للمشروع لكنها غير متاحة على مستوى النظام"
        : plugin.available
          ? "متاحة لكنها غير مفعّلة لهذا المشروع"
          : "غير متاحة على مستوى النظام";

    return (
      <li
        key={plugin.id}
        className="flex flex-col gap-3 rounded-lg border border-border bg-secondary/20 p-4 sm:flex-row sm:items-center sm:justify-between"
        data-testid={`project-plugin-${plugin.id}`}
      >
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-medium text-foreground">
              <bdi>{plugin.name}</bdi>
            </h3>
            <span className="rounded-full border border-border px-2 py-0.5 text-[10px] text-muted-foreground">
              {plugin.available ? "متاحة على مستوى النظام" : "غير متاحة"}
            </span>
          </div>
          {plugin.description && (
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              <bdi>{plugin.description}</bdi>
            </p>
          )}
          <p
            className="mt-2 text-xs font-medium text-foreground"
            data-testid={`status-project-plugin-${plugin.id}`}
            role="status"
          >
            {state}
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={plugin.projectEnabled}
          aria-label={`${plugin.projectEnabled ? "إيقاف" : "تفعيل"} فحوص الإضافة لهذا المشروع: ${plugin.name}`}
          disabled={
            updateBinding.isPending ||
            (!plugin.projectEnabled && !canEnablePlugin(plugin))
          }
          onClick={() => setProjectActivation(plugin.id, !plugin.projectEnabled)}
          className="shrink-0 rounded-md border border-border px-3 py-2 text-xs font-medium text-foreground transition hover:bg-secondary focus:outline-none focus:ring-2 focus:ring-primary disabled:cursor-not-allowed disabled:opacity-50"
          data-testid={`toggle-project-plugin-${plugin.id}`}
        >
          {plugin.projectEnabled
            ? "إيقافها لهذا المشروع"
            : "تفعيلها لهذا المشروع"}
        </button>
      </li>
    );
  };

  return (
    <section
      aria-labelledby="project-plugins-title"
      className="rounded-xl border border-border bg-card p-5 shadow-sm"
      data-testid="panel-project-plugins"
      dir="rtl"
    >
      <div className="mb-4">
        <h2 id="project-plugins-title" className="font-semibold text-foreground">
          إضافات المشروع
        </h2>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          إتاحة الإضافة على مستوى النظام لا تعني تفعيلها لهذا المشروع. فعّلها هنا
          لتشغيل فحصها المدعوم على ملفات المشروع.
        </p>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          نعرض أولًا الإضافات المتاحة والمتوافقة؛ ما لا يمكن تفعيله هنا يبقى في قسم منفصل.
        </p>
      </div>

      {pluginsQuery.isLoading ? (
        <p className="animate-pulse text-sm text-muted-foreground" role="status">
          جارٍ تحميل الإضافات…
        </p>
      ) : pluginsQuery.isError ? (
        <p className="text-sm text-destructive" role="alert">
          تعذّر تحميل إعدادات الإضافات. حدّث هذه اللوحة وحاول مرة أخرى.
        </p>
      ) : !pluginsQuery.data?.length ? (
        <p className="text-sm text-muted-foreground">
          لا توجد إضافات مسجّلة في النظام.
        </p>
      ) : (
        <div className="space-y-3">
          {visiblePlugins.length ? (
            <ul className="space-y-3" aria-label="إضافات متاحة أو مفعّلة لهذا المشروع">
              {visiblePlugins.map(renderPlugin)}
            </ul>
          ) : (
            <p className="rounded-lg border border-dashed border-border p-3 text-sm text-muted-foreground">
              لا توجد إضافات قابلة للاستخدام لهذا المشروع حاليًا.
            </p>
          )}
          {deferredPlugins.length > 0 && (
            <details
              data-testid="details-unavailable-project-plugins"
              className="rounded-lg border border-border bg-background/40 p-3"
            >
              <summary className="cursor-pointer text-sm font-medium text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                إضافات غير قابلة للتفعيل لهذا المشروع ({deferredPlugins.length})
              </summary>
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                هذه الإضافات غير متاحة أو لا تدعم فحص لغة المشروع حاليًا.
              </p>
              <ul className="mt-3 space-y-3" aria-label="إضافات غير قابلة للتفعيل لهذا المشروع">
                {deferredPlugins.map(renderPlugin)}
              </ul>
            </details>
          )}
        </div>
      )}

      {error && (
        <p className="mt-3 text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}