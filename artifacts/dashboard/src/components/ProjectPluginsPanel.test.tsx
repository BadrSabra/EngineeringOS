import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ProjectPluginsPanel from "./ProjectPluginsPanel";

const { listQuery, updateMutation } = vi.hoisted(() => ({
  listQuery: {
    data: [] as Array<Record<string, unknown>>,
    isLoading: false,
    isError: false,
  },
  updateMutation: {
    mutate: vi.fn(),
    isPending: false,
  },
}));

vi.mock("@workspace/api-client-react", () => ({
  getListProjectPluginsQueryKey: (projectId: string) => [
    "listProjectPlugins",
    projectId,
  ],
  useListProjectPlugins: () => listQuery,
  useUpdateProjectPluginBinding: () => updateMutation,
}));

function renderPanel() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");
  render(
    <QueryClientProvider client={queryClient}>
      <ProjectPluginsPanel projectId="project-a" />
    </QueryClientProvider>,
  );
  return { queryClient, invalidateQueries };
}

describe("ProjectPluginsPanel", () => {
  beforeEach(() => {
    listQuery.data = [
      {
        id: "plugin-react",
        name: "React/TypeScript Analyzer",
        description: "Scans this project.",
        version: "1.2.0",
        available: true,
        projectEnabled: false,
        scanHookImplemented: true,
        effectiveForProjectScan: false,
        capabilities: ["analyzer"],
        supportedLanguages: ["typescript"],
      },
      {
        id: "plugin-performance",
        name: "Performance Profiler",
        description: null,
        version: "1.0.3",
        available: false,
        projectEnabled: false,
        scanHookImplemented: true,
        effectiveForProjectScan: false,
        capabilities: ["analyzer"],
        supportedLanguages: ["typescript"],
      },
    ];
    updateMutation.mutate.mockReset();
    updateMutation.isPending = false;
  });

  it("shows project activation separately from global availability", () => {
    renderPanel();

    expect(
      screen.getByText("Available, not activated"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Globally unavailable"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("switch", {
        name: "Enable for project scans: Performance Profiler",
      }),
    ).toBeDisabled();
  });

  it("updates only this project's activation and refreshes the query", () => {
    updateMutation.mutate.mockImplementation(
      (_variables: unknown, callbacks: { onSuccess?: () => void }) => {
        callbacks.onSuccess?.();
      },
    );
    const { invalidateQueries } = renderPanel();

    fireEvent.click(
      screen.getByRole("switch", {
        name: "Enable for project scans: React/TypeScript Analyzer",
      }),
    );

    expect(updateMutation.mutate).toHaveBeenCalledWith(
      {
        projectId: "project-a",
        pluginId: "plugin-react",
        data: { enabled: true },
      },
      expect.objectContaining({
        onSuccess: expect.any(Function),
        onError: expect.any(Function),
      }),
    );
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["listProjectPlugins", "project-a"],
    });
  });
});