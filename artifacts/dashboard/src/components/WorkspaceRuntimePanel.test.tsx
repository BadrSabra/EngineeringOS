import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import WorkspaceRuntimePanel from './WorkspaceRuntimePanel';

const projectId = 'project-1';
let runtime: {
  projectId: string;
  sessionId: string;
  status: 'running' | 'stopped';
  port: number;
  command: 'pnpm run dev';
  revision: string;
  startedAt: string;
  stoppedAt: string | null;
  pid: number | null;
  error: string | null;
  logs: string[];
};

function runtimeSnapshot(status: 'running' | 'stopped') {
  return {
    projectId,
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

function renderPanel() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchIntervalInBackground: false },
      mutations: { retry: false },
    },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <WorkspaceRuntimePanel projectId={projectId} />
    </QueryClientProvider>,
  );
  return queryClient;
}

beforeEach(() => {
  runtime = runtimeSnapshot('running');
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).endsWith('/runtime/stop') && init?.method === 'POST') {
      runtime = runtimeSnapshot('stopped');
    }
    return {
      ok: true,
      json: async () => runtime,
    };
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

    await waitFor(() => {
      expect(screen.getByText('متوقّف')).toBeInTheDocument();
    });
    expect(fetch).toHaveBeenCalledWith(
      '/api/projects/project-1/runtime/stop',
      expect.objectContaining({ method: 'POST', body: '{}' }),
    );
  });

  it('shows a localized failure state when the runtime cannot be loaded', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));

    renderPanel();

    expect(
      await screen.findByText('تعذّر تحميل حالة تشغيل المشروع. حدّث المشروع وحاول مرة أخرى.'),
    ).toBeInTheDocument();
  });
});
