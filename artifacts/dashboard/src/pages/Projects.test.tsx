import { act, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import Projects from "./Projects";
import { readGoalDrafts, storeHomeGoalDraft } from '../lib/home-goal-handoff';

const mocks = vi.hoisted(() => ({
  setLocation: vi.fn(), mutate: vi.fn(),
  invalidateQueries: vi.fn(() => Promise.resolve()),
  ownerId: 'user-1',
}));
vi.mock('@clerk/react', () => ({
  useUser: () => ({ isLoaded: true, user: { id: mocks.ownerId } }),
}));
vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: mocks.invalidateQueries }),
}));

// Mock the generated API client hook
vi.mock("@workspace/api-client-react", () => ({
  useListProjects: vi.fn(),
  useStartProjectBootstrap: () => ({ mutate: mocks.mutate, isPending: false }),
  useGetProjectBootstrap: vi.fn(),
  getGetProjectBootstrapQueryKey: (id: string) => ['/api/projects/bootstrap', id],
  getListProjectsQueryKey: () => ["projects"],
  classifyProjectError: (err: unknown) => err,
  isRetryableProjectError: () => false,
  emitProjectLoadFailed: vi.fn(),
}));

// Mock wouter
vi.mock("wouter", () => ({
  useLocation: () => ['/projects', mocks.setLocation],
  Link: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

// Mock DiscoverProjectWizard — integration tested separately
vi.mock("./DiscoverProjectWizard", () => ({
  DiscoverProjectWizard: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="discover-wizard">
      <button onClick={onClose}>Close</button>
    </div>
  ),
}));

import { useListProjects, useGetProjectBootstrap } from "@workspace/api-client-react";

const mockProjects = [
  { id: "1", name: "alpha-service", status: "active", language: "TypeScript", qualityScore: 0.9, lastScanAt: null },
  { id: "2", name: "beta-worker", status: "scanning", language: "Python", qualityScore: null, lastScanAt: null },
  { id: "3", name: "gamma-lib", status: "archived", language: "TypeScript", qualityScore: 0.7, lastScanAt: null },
];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.ownerId = 'user-1';
  window.sessionStorage.clear();
  window.history.replaceState({}, '', '/projects');
  vi.mocked(useGetProjectBootstrap).mockReturnValue({
    data: undefined, isLoading: false,
  } as ReturnType<typeof useGetProjectBootstrap>);
  vi.mocked(useListProjects).mockReturnValue({
    data: mockProjects,
    isLoading: false,
    isError: false,
    error: null,
  } as ReturnType<typeof useListProjects>);
});

describe("Projects", () => {
  it("renders all projects when search is empty", () => {
    render(<Projects />);
    expect(screen.getByText("alpha-service")).toBeInTheDocument();
    expect(screen.getByText("beta-worker")).toBeInTheDocument();
    expect(screen.getByText("gamma-lib")).toBeInTheDocument();
  });

  it("filters projects by name (case-insensitive)", () => {
    render(<Projects />);
    const input = screen.getByRole('textbox', { name: 'ابحث عن مشروع' });
    fireEvent.change(input, { target: { value: "ALPHA" } });
    expect(screen.getByText("alpha-service")).toBeInTheDocument();
    expect(screen.queryByText("beta-worker")).not.toBeInTheDocument();
    expect(screen.queryByText("gamma-lib")).not.toBeInTheDocument();
  });

  it("shows empty state when no projects match the search", () => {
    render(<Projects />);
    const input = screen.getByRole('textbox', { name: 'ابحث عن مشروع' });
    fireEvent.change(input, { target: { value: "zzz-no-match" } });
    expect(screen.queryByText("alpha-service")).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('لا توجد مشاريع تطابق بحثك');
    expect(mocks.mutate).not.toHaveBeenCalled();
  });

  it("renders loading skeletons while fetching", () => {
    vi.mocked(useListProjects).mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
      error: null,
    } as ReturnType<typeof useListProjects>);
    render(<Projects />);
    // Skeleton cards have animate-pulse; heading should still be present
    expect(screen.getByRole('heading', { level: 1, name: 'المشاريع' })).toBeInTheDocument();
  });

  it("opens discover wizard when Discover Project button is clicked", () => {
    render(<Projects />);
    fireEvent.click(screen.getByRole("button", { name: 'استكشف مشروعًا موجودًا' }));
    expect(screen.getByTestId("discover-wizard")).toBeInTheDocument();
  });

  it("closes discover wizard when onClose is called", () => {
    render(<Projects />);
    fireEvent.click(screen.getByRole("button", { name: 'استكشف مشروعًا موجودًا' }));
    expect(screen.getByTestId("discover-wizard")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /close/i }));
    expect(screen.queryByTestId("discover-wizard")).not.toBeInTheDocument();
  });

  it('persists the goal before invoking the existing bootstrap and resumes the same operation after reload', async () => {
    const draft = storeHomeGoalDraft('أنشئ تطبيق العملاء', 'user-1')!;
    window.history.replaceState({}, '', `/projects?create=1&goalDraftId=${draft.id}`);
    mocks.mutate.mockImplementation((_params, options) => options.onSuccess({
      id: 'operation-a', status: 'pending', projectId: null,
    }));
    const view = render(<Projects />);
    expect(screen.getByTestId('input-project-description')).toHaveValue(draft.text);
    expect(mocks.mutate).not.toHaveBeenCalled();
    fireEvent.change(screen.getByTestId('input-project-name'), { target: { value: 'Client App' } });
    fireEvent.click(screen.getByTestId('button-start-project-bootstrap'));
    const saved = readGoalDrafts('user-1').drafts[0];
    expect(saved.bootstrap?.operationId).toBe('operation-a');
    expect(mocks.mutate).toHaveBeenCalledWith({
      data: { name: 'Client App', description: draft.text, idempotencyKey: saved.bootstrap?.idempotencyKey },
    }, expect.anything());
    view.unmount();
    vi.mocked(useGetProjectBootstrap).mockReturnValue({
      data: { id: 'operation-a', status: 'completed', projectId: 'created-project' }, isLoading: false,
    } as ReturnType<typeof useGetProjectBootstrap>);
    render(<Projects />);
    await waitFor(() => expect(mocks.setLocation).toHaveBeenCalledWith(`/ai?projectId=created-project&goalDraftId=${draft.id}`));
    expect(mocks.mutate).toHaveBeenCalledTimes(1);
    expect(readGoalDrafts('user-1').drafts[0].projectId).toBe('created-project');
    expect(readGoalDrafts('user-1').drafts[0].text).toBe(draft.text);
    expect(readGoalDrafts('user-1').drafts[0].sendAttemptedAt).toBeNull();
  });

  it('does not start creation or discard input when draft persistence fails', () => {
    const draft = storeHomeGoalDraft('هدف محفوظ', 'user-1')!;
    window.history.replaceState({}, '', `/projects?create=1&goalDraftId=${draft.id}`);
    render(<Projects />);
    fireEvent.change(screen.getByTestId('input-project-name'), { target: { value: 'Client App' } });
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    fireEvent.click(screen.getByTestId('button-start-project-bootstrap'));
    expect(mocks.mutate).not.toHaveBeenCalled();
    expect(screen.getByTestId('status-bootstrap-error')).toHaveTextContent('لم نبدأ الطلب');
    expect(screen.getByTestId('input-project-description')).toHaveValue(draft.text);
    spy.mockRestore();
  });

  it('does not expose or resume another account’s bootstrap draft', () => {
    const draft = storeHomeGoalDraft('هدف خاص', 'user-1')!;
    window.history.replaceState({}, '', `/projects?create=1&goalDraftId=${draft.id}`);
    mocks.ownerId = 'user-2';
    render(<Projects />);
    expect(screen.queryByDisplayValue(draft.text)).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('غير متاحة لهذا الحساب');
    expect(mocks.mutate).not.toHaveBeenCalled();
    expect(useGetProjectBootstrap).toHaveBeenCalledWith('', expect.objectContaining({
      query: expect.objectContaining({ enabled: false }),
    }));
  });

  it('does not navigate a closed creation form when a late completion arrives', async () => {
    const draft = storeHomeGoalDraft('هدف العملية الأصلية', 'user-1')!;
    window.history.replaceState({}, '', `/projects?create=1&goalDraftId=${draft.id}`);
    let complete!: (result: unknown) => void;
    mocks.mutate.mockImplementation((_params, options) => { complete = options.onSuccess; });
    render(<Projects />);
    fireEvent.change(screen.getByTestId('input-project-name'), { target: { value: 'Original Project' } });
    fireEvent.click(screen.getByTestId('button-start-project-bootstrap'));
    fireEvent.click(screen.getByRole('button', { name: 'إلغاء' }));
    await act(async () => complete({ id: 'late-operation', status: 'completed', projectId: 'late-project' }));
    expect(mocks.setLocation).not.toHaveBeenCalled();
    expect(readGoalDrafts('user-1').drafts[0].bootstrap?.operationId).toBe('late-operation');
    expect(readGoalDrafts('user-1').drafts[0].projectId).toBeNull();
  });
});
