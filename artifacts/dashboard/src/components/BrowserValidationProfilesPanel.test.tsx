import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import BrowserValidationProfilesPanel from './BrowserValidationProfilesPanel';

const mocks = vi.hoisted(() => ({
  profiles: [] as any[],
  profilesLoading: false,
  profilesError: false,
  profileError: null as unknown,
  listRefetch: vi.fn(),
  upsert: { mutate: vi.fn(), isPending: false },
  remove: { mutate: vi.fn(), isPending: false },
}));

vi.mock('@workspace/api-client-react', () => ({
  getListBrowserValidationProfilesQueryKey: (projectId: string) => [
    `/api/projects/${projectId}/browser-validation-profiles`,
  ],
  useListBrowserValidationProfiles: () => ({
    data: mocks.profiles,
    isLoading: mocks.profilesLoading,
    isFetching: false,
    isError: mocks.profilesError,
    error: mocks.profileError,
    refetch: mocks.listRefetch,
  }),
  useUpsertBrowserValidationProfile: () => mocks.upsert,
  useDeleteBrowserValidationProfile: () => mocks.remove,
}));

const profile = (overrides: Record<string, unknown> = {}) => ({
  id: 'profile-1',
  projectId: 'project-1',
  name: 'smoke',
  revision: '2026-09-27T12:00:00.000Z',
  permittedOrigin: 'http://127.0.0.1:4300',
  steps: [{ type: 'navigate', path: '/' }],
  timeoutMs: 5_000,
  createdAt: '2026-09-27T12:00:00.000Z',
  updatedAt: '2026-09-27T12:05:00.000Z',
  currentRevision: '2026-09-27T12:00:00.000Z',
  freshnessStatus: 'fresh',
  freshnessReason: null,
  ...overrides,
});

function renderPanel() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries');
  render(
    <QueryClientProvider client={queryClient}>
      <BrowserValidationProfilesPanel projectId="project-1" />
    </QueryClientProvider>,
  );
  return { queryClient, invalidateQueries };
}

beforeEach(() => {
  mocks.profiles = [];
  mocks.profilesLoading = false;
  mocks.profilesError = false;
  mocks.profileError = null;
  mocks.listRefetch.mockReset();
  mocks.upsert.mutate.mockReset();
  mocks.remove.mutate.mockReset();
  mocks.upsert.isPending = false;
  mocks.remove.isPending = false;
});

describe('BrowserValidationProfilesPanel', () => {
  it('creates a profile with all five supported step types using the generated mutation', async () => {
    const { invalidateQueries } = renderPanel();
    fireEvent.click(screen.getByRole('button', { name: /add profile/i }));

    fireEvent.change(screen.getByLabelText('Profile name'), { target: { value: 'dashboard.smoke' } });
    for (let index = 0; index < 4; index += 1) {
      fireEvent.click(screen.getByRole('button', { name: 'Add step' }));
    }
    fireEvent.change(screen.getByLabelText('Step 2 type'), { target: { value: 'assert_visible' } });
    fireEvent.change(screen.getByLabelText('Step 3 type'), { target: { value: 'assert_text' } });
    fireEvent.change(screen.getByLabelText('Step 3 text to find'), { target: { value: 'Dashboard ready' } });
    fireEvent.change(screen.getByLabelText('Step 4 type'), { target: { value: 'read_visible_text' } });
    fireEvent.change(screen.getByLabelText('Step 5 type'), { target: { value: 'screenshot' } });
    fireEvent.change(screen.getByLabelText('Step 5 screenshot name'), { target: { value: 'overview' } });

    fireEvent.click(screen.getByTestId('button-save-browser-profile'));
    await waitFor(() => {
      expect(mocks.upsert.mutate).toHaveBeenCalledWith(
        {
          projectId: 'project-1',
          name: 'dashboard.smoke',
          data: {
            timeoutMs: 60_000,
            steps: [
              { type: 'navigate', path: '/' },
              { type: 'assert_visible', selector: 'body' },
              { type: 'assert_text', selector: 'body', text: 'Dashboard ready' },
              { type: 'read_visible_text' },
              { type: 'screenshot', name: 'overview' },
            ],
          },
        },
        expect.objectContaining({
          onSuccess: expect.any(Function),
          onError: expect.any(Function),
        }),
      );
    });

    const [, callbacks] = mocks.upsert.mutate.mock.calls[0] as [
      unknown,
      { onSuccess: (saved: ReturnType<typeof profile>) => void },
    ];
    act(() => callbacks.onSuccess(profile({ name: 'dashboard.smoke' })));
    expect(screen.getByRole('status')).toHaveTextContent('Profile “dashboard.smoke” saved.');
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['/api/projects/project-1/browser-validation-profiles'],
    });
  });

  it('edits a profile and presents server validation errors without changing the profile name', async () => {
    mocks.profiles = [profile({ freshnessStatus: 'stale', freshnessReason: 'stale_revision' })];
    renderPanel();

    expect(screen.getByText('Stale revision')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Edit browser profile smoke' }));
    expect(screen.getByLabelText('Profile name')).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Timeout (milliseconds)'), { target: { value: '7000' } });
    fireEvent.change(screen.getByLabelText('Step 1 type'), { target: { value: 'assert_text' } });
    fireEvent.change(screen.getByLabelText('Step 1 text to find'), { target: { value: 'Ready' } });
    fireEvent.click(screen.getByTestId('button-save-browser-profile'));

    await waitFor(() => expect(mocks.upsert.mutate).toHaveBeenCalledWith(
      {
        projectId: 'project-1',
        name: 'smoke',
        data: {
          timeoutMs: 7_000,
          steps: [{ type: 'assert_text', selector: 'body', text: 'Ready' }],
        },
      },
      expect.objectContaining({ onError: expect.any(Function) }),
    ));

    const [, callbacks] = mocks.upsert.mutate.mock.calls[0] as [
      unknown,
      { onError: (error: Error) => void },
    ];
    act(() => callbacks.onError(new Error('Project write access required.')));
    expect(screen.getByRole('alert')).toHaveTextContent('Project write access required.');
    expect(screen.getByLabelText('Profile name')).toHaveValue('smoke');
  });

  it('confirms deletion, displays authorization failures, and refreshes after success', async () => {
    mocks.profiles = [profile()];
    const { invalidateQueries } = renderPanel();

    fireEvent.click(screen.getByRole('button', { name: 'Delete browser profile smoke' }));
    expect(screen.getByRole('alertdialog')).toHaveTextContent('This cannot be undone.');
    fireEvent.click(screen.getByTestId('button-confirm-delete-browser-profile'));
    await waitFor(() => expect(mocks.remove.mutate).toHaveBeenCalledWith(
      { projectId: 'project-1', name: 'smoke' },
      expect.objectContaining({ onError: expect.any(Function), onSuccess: expect.any(Function) }),
    ));

    const [, callbacks] = mocks.remove.mutate.mock.calls[0] as [
      unknown,
      { onError: (error: Error) => void; onSuccess: () => void },
    ];
    act(() => callbacks.onError(new Error('Project write access required.')));
    expect(screen.getByRole('alert')).toHaveTextContent('Project write access required.');

    fireEvent.click(screen.getByTestId('button-confirm-delete-browser-profile'));
    const [, retryCallbacks] = mocks.remove.mutate.mock.calls[1] as [
      unknown,
      { onSuccess: () => void },
    ];
    act(() => retryCallbacks.onSuccess());
    expect(screen.getByRole('status')).toHaveTextContent('Profile “smoke” deleted.');
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['/api/projects/project-1/browser-validation-profiles'],
    });
  });

  it('rejects a protocol-relative navigation path before sending it to the server', () => {
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: /add profile/i }));
    fireEvent.change(screen.getByLabelText('Profile name'), { target: { value: 'unsafe' } });
    fireEvent.change(screen.getByLabelText('Step 1 path'), { target: { value: '//outside.example' } });
    fireEvent.click(screen.getByTestId('button-save-browser-profile'));

    expect(screen.getByRole('alert')).toHaveTextContent('use a relative path beginning with one slash');
    expect(mocks.upsert.mutate).not.toHaveBeenCalled();
  });
});