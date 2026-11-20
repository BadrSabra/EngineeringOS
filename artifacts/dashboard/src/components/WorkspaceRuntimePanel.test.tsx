import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import WorkspaceRuntimePanel from './WorkspaceRuntimePanel';

const projectId = 'project-1';
type RuntimeStatus = 'running' | 'starting' | 'stopped' | 'failed';
type RuntimeFixture = {
  projectId: string;
  sessionId: string;
  status: RuntimeStatus;
  port: number;
  command: 'pnpm run dev';
  revision: string;
  startedAt: string;
  stoppedAt: string | null;
  pid: number | null;
  error: string | null;
  logs: string[];
};
let runtimeByProject: Record<string, RuntimeFixture>;
const pendingActions = new Map<string, (snapshot: RuntimeFixture) => void>();

function runtimeSnapshot(status: RuntimeStatus, ownerProjectId = projectId): RuntimeFixture {
  return {
    projectId: ownerProjectId,
    sessionId: 'session-1',
    status,
    port: 5173,
    command: 'pnpm run dev' as const,
    revision: 'revision-a1b2',
    startedAt: '2026-10-14T12:00:00.000Z',
    stoppedAt: status === 'stopped' ? '2026-10-14T12:05:00.000Z' : null,
    pid: status === 'running' ? 2345 : null,
    error: null,
    logs: ['VITE ready at http://localhost:5173'],
  };
}

function renderPanel(targetProjectId = projectId) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchIntervalInBackground: false },
      mutations: { retry: false },
    },
  });
  const view = render(
    <QueryClientProvider client={queryClient}>
      <WorkspaceRuntimePanel projectId={targetProjectId} />
    </QueryClientProvider>,
  );
  return { ...view, queryClient };
}

function response(snapshot: unknown) {
  return { ok: true, json: async () => snapshot };
}

beforeEach(() => {
  runtimeByProject = {
    [projectId]: runtimeSnapshot('running', projectId),
    'project-2': runtimeSnapshot('running', 'project-2'),
  };
  pendingActions.clear();
  vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const match = String(input).match(/\/api\/projects\/([^/]+)\/runtime(?:\/(start|restart|stop))?$/);
    if (!match) throw new Error(`Unexpected runtime URL: ${String(input)}`);
    const requestedProjectId = decodeURIComponent(match[1]!);
    const nextAction = match[2];
    if (init?.method === 'POST' && nextAction) {
      return new Promise((resolve) => {
        pendingActions.set(`${requestedProjectId}:${nextAction}`, (snapshot) => {
          runtimeByProject[requestedProjectId] = snapshot;
          resolve(response(snapshot));
        });
      });
    }
    return Promise.resolve(response(runtimeByProject[requestedProjectId]));
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('WorkspaceRuntimePanel', () => {
  it('renders Arabic status and labels while keeping runtime values LTR and stop action unchanged', async () => {
    renderPanel();

    expect(await screen.findByText('قيد التشغيل')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'تشغيل المشروع' })).toBeInTheDocument();
    expect(screen.getByText('pnpm run dev')).toHaveAttribute('dir', 'ltr');
    expect(screen.getByText('revision-a1b2')).toHaveAttribute('dir', 'ltr');
    expect(screen.getByText(/VITE ready/)).toHaveAttribute('dir', 'ltr');

    fireEvent.click(screen.getByRole('button', { name: 'إيقاف التشغيل' }));
    await waitFor(() => expect(pendingActions.has('project-1:stop')).toBe(true));

    await act(async () => {
      pendingActions.get('project-1:stop')!(runtimeSnapshot('stopped', 'project-1'));
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(screen.getByText('متوقّف')).toBeInTheDocument();
    });
    expect(fetch).toHaveBeenCalledWith(
      '/api/projects/project-1/runtime/stop',
      expect.objectContaining({ method: 'POST', body: '{}' }),
    );
  });

  it('rejects a runtime snapshot whose project identity differs from the requested project', async () => {
    runtimeByProject[projectId] = runtimeSnapshot('running', 'project-foreign');

    renderPanel();

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'أعاد الخادم حالة تشغيل تخص مشروعًا آخر. لم نعرض بياناتها داخل مساحة هذا المشروع.',
    );
    expect(screen.queryByText('2345')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'إيقاف التشغيل' })).not.toBeInTheDocument();
  });

  it('keeps pending runtime actions isolated when the panel switches projects', async () => {
    const view = renderPanel('project-1');

    expect(await screen.findByText('قيد التشغيل')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'إيقاف التشغيل' }));
    await waitFor(() => expect(pendingActions.has('project-1:stop')).toBe(true));

    view.rerender(
      <QueryClientProvider client={view.queryClient}>
        <WorkspaceRuntimePanel projectId="project-2" />
      </QueryClientProvider>,
    );
    expect(await screen.findByText('قيد التشغيل')).toBeInTheDocument();
    const secondProjectStop = screen.getByRole('button', { name: 'إيقاف التشغيل' });
    expect(secondProjectStop).toBeEnabled();
    fireEvent.click(secondProjectStop);
    await waitFor(() => expect(pendingActions.has('project-2:stop')).toBe(true));
    expect(screen.getByRole('button', { name: 'إيقاف التشغيل' })).toBeDisabled();

    await act(async () => {
      pendingActions.get('project-1:stop')!(runtimeSnapshot('stopped', 'project-1'));
      await Promise.resolve();
    });

    // The old project's completion must not clear the new project's busy state.
    expect(screen.getByRole('button', { name: 'إيقاف التشغيل' })).toBeDisabled();

    await act(async () => {
      pendingActions.get('project-2:stop')!(runtimeSnapshot('stopped', 'project-2'));
      await Promise.resolve();
    });
    expect(await screen.findByText('متوقّف')).toBeInTheDocument();
  });

  it('does not cache a mutation response under a different project identity', async () => {
    runtimeByProject[projectId] = runtimeSnapshot('stopped', projectId);
    const view = renderPanel();
    expect(await screen.findByText('متوقّف')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'تشغيل المعاينة' }));
    await waitFor(() => expect(pendingActions.has('project-1:start')).toBe(true));

    await act(async () => {
      pendingActions.get('project-1:start')!(runtimeSnapshot('running', 'project-2'));
      await Promise.resolve();
    });

    expect(screen.getByRole('alert')).toHaveTextContent(
      'أعاد الخادم حالة تشغيل تخص مشروعًا آخر.',
    );
    expect(screen.queryByText('2345')).not.toBeInTheDocument();
    expect(view.queryClient.getQueryData(['workspace-runtime', 'project-1']))
      .toEqual(runtimeSnapshot('stopped', 'project-1'));
  });

  it('shows a localized failure state when the runtime cannot be loaded', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));

    renderPanel();

    expect(
      await screen.findByText('تعذّر تحميل حالة تشغيل المشروع. حدّث المشروع وحاول مرة أخرى.'),
    ).toBeInTheDocument();
  });
});
