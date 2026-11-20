import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QuickNavigation } from './QuickNavigation';

let originalScrollIntoView: PropertyDescriptor | undefined;
let originalCanvasGetContext: PropertyDescriptor | undefined;

const mocks = vi.hoisted(() => ({
  setLocation: vi.fn(),
  projects: {
    data: [] as { id: string; name: string }[],
    isLoading: false,
    isError: false,
  },
}));

vi.mock('@clerk/react', () => ({
  useUser: () => ({ user: { id: 'user-1' }, isLoaded: true }),
}));

vi.mock('@workspace/api-client-react', () => ({
  getListProjectsQueryKey: () => ['/api/projects'],
  useListProjects: () => mocks.projects,
}));

vi.mock('wouter', () => ({
  useLocation: () => ['/', mocks.setLocation],
}));

beforeEach(() => {
  originalScrollIntoView = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView');
  originalCanvasGetContext = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, 'getContext');
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: vi.fn(),
  });
  Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
    configurable: true,
    value: vi.fn(() => null),
  });
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    unobserve() {}
    disconnect() {}
  });
  vi.clearAllMocks();
  mocks.projects.data = [];
  mocks.projects.isLoading = false;
  mocks.projects.isError = false;
});

afterEach(() => {
  if (originalScrollIntoView) {
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', originalScrollIntoView);
  } else {
    Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView');
  }
  if (originalCanvasGetContext) {
    Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', originalCanvasGetContext);
  } else {
    Reflect.deleteProperty(HTMLCanvasElement.prototype, 'getContext');
  }
  vi.unstubAllGlobals();
});

describe('quick navigation', () => {
  it('searches project names and opens the selected workspace', async () => {
    mocks.projects.data = [
      { id: 'project-1', name: 'دفتر الورشة' },
      { id: 'project-2', name: 'متجر العائلة' },
    ];
    render(<QuickNavigation />);

    fireEvent.click(screen.getByTestId('button-open-quick-navigation'));
    const search = await screen.findByRole('combobox', { name: 'ابحث عن صفحة أو مشروع' });
    fireEvent.change(search, { target: { value: 'الورشة' } });
    fireEvent.click(await screen.findByTestId('quick-nav-project-project-1'));

    expect(mocks.setLocation).toHaveBeenCalledWith('/projects/project-1/workspace');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('opens from the keyboard shortcut while preserving text-field input', async () => {
    render(<><QuickNavigation /><input aria-label="حقل آخر" /></>);
    fireEvent.keyDown(document, { key: 'k', ctrlKey: true });
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('combobox', { name: 'ابحث عن صفحة أو مشروع' }), {
      key: 'k',
      ctrlKey: true,
    });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('keeps page navigation available when project loading fails', async () => {
    mocks.projects.isError = true;
    render(<QuickNavigation />);

    fireEvent.click(screen.getByTestId('button-open-quick-navigation'));
    expect(await screen.findByRole('status')).toHaveTextContent('تعذر تحميل المشاريع');
    fireEvent.click(screen.getByTestId('quick-nav-page-projects'));

    expect(mocks.setLocation).toHaveBeenCalledWith('/projects');
  });
});
