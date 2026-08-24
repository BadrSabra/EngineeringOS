import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import GitPanel from './GitPanel';

const mocks = vi.hoisted(() => {
  const mutation = () => ({
    mutate: vi.fn(),
    isPending: false,
    isError: false,
    error: null,
    isSuccess: false,
    data: undefined,
  });

  return {
    queries: {
      config: { remoteUrl: 'https://github.com/acme/service.git', branch: 'main' },
      token: { configured: false, last4: null },
      status: { clean: false, files: [{ path: 'src/index.ts', status: ' M' }] },
      log: { commits: [] },
    },
    mutations: {
      updateConfig: mutation(),
      saveToken: mutation(),
      deleteToken: mutation(),
      commit: mutation(),
      push: mutation(),
    },
    mutationOptions: {
      updateConfig: undefined as { onSuccess?: () => void } | undefined,
      saveToken: undefined as { onSuccess?: () => void } | undefined,
      deleteToken: undefined as { onSuccess?: () => void } | undefined,
      commit: undefined as { onSuccess?: () => void } | undefined,
      push: undefined as { onSuccess?: () => void } | undefined,
    },
  };
});

vi.mock('@workspace/api-client-react', () => ({
  useGetGitConfig: vi.fn(() => ({ data: mocks.queries.config, isLoading: false, isError: false, error: null })),
  useGetGitHubTokenStatus: vi.fn(() => ({ data: mocks.queries.token, isLoading: false, isError: false, error: null })),
  useGetGitStatus: vi.fn(() => ({
    data: mocks.queries.status,
    isLoading: false,
    isError: false,
    error: null,
    isFetching: false,
    isSuccess: true,
  })),
  useGetGitLog: vi.fn(() => ({ data: mocks.queries.log, isLoading: false, isError: false, error: null })),
  useUpdateGitConfig: vi.fn((options) => {
    mocks.mutationOptions.updateConfig = options?.mutation;
    return mocks.mutations.updateConfig;
  }),
  useSaveGitHubToken: vi.fn((options) => {
    mocks.mutationOptions.saveToken = options?.mutation;
    return mocks.mutations.saveToken;
  }),
  useDeleteGitHubToken: vi.fn((options) => {
    mocks.mutationOptions.deleteToken = options?.mutation;
    return mocks.mutations.deleteToken;
  }),
  useGitCommit: vi.fn((options) => {
    mocks.mutationOptions.commit = options?.mutation;
    return mocks.mutations.commit;
  }),
  useGitPush: vi.fn((options) => {
    mocks.mutationOptions.push = options?.mutation;
    return mocks.mutations.push;
  }),
}));

function renderPanel() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries');
  render(
    <QueryClientProvider client={queryClient}>
      <GitPanel projectId="project-1" />
    </QueryClientProvider>,
  );
  return { invalidateQueries };
}

beforeEach(() => {
  mocks.queries.config = { remoteUrl: 'https://github.com/acme/service.git', branch: 'main' };
  mocks.queries.token = { configured: false, last4: null };
  mocks.queries.status = { clean: false, files: [{ path: 'src/index.ts', status: ' M' }] };
  mocks.queries.log = { commits: [] };

  for (const mutation of Object.values(mocks.mutations)) {
    mutation.mutate.mockReset();
    mutation.isPending = false;
    mutation.isError = false;
    mutation.error = null;
    mutation.isSuccess = false;
    mutation.data = undefined;
  }
  mocks.mutationOptions.updateConfig = undefined;
  mocks.mutationOptions.saveToken = undefined;
  mocks.mutationOptions.deleteToken = undefined;
  mocks.mutationOptions.commit = undefined;
  mocks.mutationOptions.push = undefined;
});

describe('GitPanel generated mutations', () => {
  it('sends the real payloads for settings, commit, and push', () => {
    mocks.queries.token = { configured: true, last4: '1234' };
    renderPanel();

    fireEvent.click(screen.getByTitle('Configure'));
    fireEvent.change(screen.getByPlaceholderText('https://github.com/owner/repo.git'), {
      target: { value: 'https://github.com/acme/updated.git' },
    });
    fireEvent.change(screen.getByPlaceholderText('main'), { target: { value: 'release' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Save' })[0]);

    expect(mocks.mutations.updateConfig.mutate).toHaveBeenCalledWith({
      projectId: 'project-1',
      data: { remoteUrl: 'https://github.com/acme/updated.git', branch: 'release' },
    });

    fireEvent.change(screen.getByPlaceholderText('Commit message…'), {
      target: { value: 'Ship generated client migration' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Commit all changes' }));
    expect(mocks.mutations.commit.mutate).toHaveBeenCalledWith({
      projectId: 'project-1',
      data: { message: 'Ship generated client migration' },
    });

    fireEvent.click(screen.getByRole('button', { name: /Push to main/i }));
    expect(mocks.mutations.push.mutate).toHaveBeenCalledWith({ projectId: 'project-1' });
  });

  it('sends token mutations and invalidates the right queries after success', () => {
    mocks.queries.token = { configured: true, last4: '1234' };
    const { invalidateQueries } = renderPanel();

    fireEvent.click(screen.getByTitle('Configure'));
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(mocks.mutations.deleteToken.mutate).toHaveBeenCalledWith();
    mocks.mutationOptions.deleteToken?.onSuccess?.();
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['github-token'] });

    // The configured-token state intentionally shows Remove instead of Save.
    // Render the save flow with the unconfigured state in a fresh test render.
    mocks.queries.token = { configured: false, last4: null };
    renderPanel();
    fireEvent.click(screen.getAllByTitle('Configure')[1] ?? screen.getByTitle('Configure'));
    fireEvent.change(screen.getByPlaceholderText('ghp_...'), { target: { value: 'ghp_test_token' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Save' }).at(-1)!);
    expect(mocks.mutations.saveToken.mutate).toHaveBeenCalledWith({ data: { token: 'ghp_test_token' } });
    mocks.mutationOptions.saveToken?.onSuccess?.();
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['github-token'] });
  });

  it('renders a structured mutation error instead of failing silently', () => {
    mocks.mutations.updateConfig.isError = true;
    mocks.mutations.updateConfig.error = new Error('Remote URL rejected');
    renderPanel();

    fireEvent.click(screen.getByTitle('Configure'));
    expect(screen.getByText('Remote URL rejected')).toBeInTheDocument();
  });
});