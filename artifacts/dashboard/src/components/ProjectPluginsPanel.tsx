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

  const setProjectActivation = (
    pluginId: string,
    enabled: boolean,
    configuration: Record<string, unknown>,
  ) => {
    setError(null);
    updateBinding.mutate(
      { projectId, pluginId, data: { enabled, configuration } },
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
              : "Could not update project plugin activation.",
          );
        },
      },
    );
  };

  return (
    <section
      aria-labelledby="project-plugins-title"
      className="rounded-xl border border-border bg-card p-5 shadow-sm"
      data-testid="panel-project-plugins"
    >
      <div className="mb-4">
        <h2 id="project-plugins-title" className="font-semibold text-foreground">
          Project plugins
        </h2>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          Global availability is only a ceiling. Enable a plugin here to run its
          supported scan hook for this project.
        </p>
      </div>

      {pluginsQuery.isLoading ? (
        <p className="animate-pulse text-sm text-muted-foreground" role="status">
          Loading project plugins…
        </p>
      ) : pluginsQuery.isError ? (
        <p className="text-sm text-destructive" role="alert">
          Plugin settings could not be loaded. Refresh this panel to try again.
        </p>
      ) : !pluginsQuery.data?.length ? (
        <p className="text-sm text-muted-foreground">
          No plugin definitions are registered.
        </p>
      ) : (
        <ul className="space-y-3" aria-label="Project plugins">
          {pluginsQuery.data.map((plugin) => {
            const state = plugin.effectiveForProjectScan
              ? "Active for project scans"
              : !plugin.scanHookImplemented
                ? "No scan hook is registered"
              : plugin.projectEnabled
                ? "Project-enabled, but globally unavailable"
                : plugin.available
                  ? "Available, not activated"
                  : "Globally unavailable";

            return (
              <li
                key={plugin.id}
                className="flex flex-col gap-3 rounded-lg border border-border bg-secondary/20 p-4 sm:flex-row sm:items-center sm:justify-between"
                data-testid={`project-plugin-${plugin.id}`}
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-sm font-medium text-foreground">
                      {plugin.name}
                    </h3>
                    <span className="rounded-full border border-border px-2 py-0.5 text-[10px] text-muted-foreground">
                      {plugin.available ? "Globally available" : "Unavailable"}
                    </span>
                  </div>
                  {plugin.description && (
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                      {plugin.description}
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
                  aria-label={`${plugin.projectEnabled ? "Disable" : "Enable"} for project scans: ${plugin.name}`}
                  disabled={
                    updateBinding.isPending ||
                    (!plugin.projectEnabled &&
                      (!plugin.available || !plugin.scanHookImplemented))
                  }
                  onClick={() =>
                    setProjectActivation(
                      plugin.id,
                      !plugin.projectEnabled,
                      plugin.configuration,
                    )
                  }
                  className="shrink-0 rounded-md border border-border px-3 py-2 text-xs font-medium text-foreground transition hover:bg-secondary focus:outline-none focus:ring-2 focus:ring-primary disabled:cursor-not-allowed disabled:opacity-50"
                  data-testid={`toggle-project-plugin-${plugin.id}`}
                >
                  {plugin.projectEnabled
                    ? "Disable for project"
                    : "Enable for project"}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {error && (
        <p className="mt-3 text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}