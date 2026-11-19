import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import axe from 'axe-core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Router } from 'wouter';
import { Shell } from './Shell';

const mocks = vi.hoisted(() => ({
  signOut: vi.fn(),
  projects: {
    data: [] as { id: string; name: string; updatedAt: Date }[],
    isLoading: false,
    isError: false,
  },
}));

vi.mock('@clerk/react', () => ({
  useUser: () => ({ user: { fullName: 'Test Operator' }, isLoaded: true }),
  useClerk: () => ({ signOut: mocks.signOut }),
}));

vi.mock('@workspace/api-client-react', () => ({
  getListProjectsQueryKey: () => ['/api/projects'],
  useListProjects: () => mocks.projects,
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  mocks.projects.data = [];
  window.history.replaceState({}, '', '/');
  document.body.style.overflow = '';
});

describe('Shell mobile navigation', () => {
  it('opens the most recently updated project workspace directly from the sidebar', () => {
    mocks.projects.data = [
      { id: 'project-older', name: 'مشروع أقدم', updatedAt: new Date('2026-11-10T12:00:00Z') },
      { id: 'project-newer', name: 'مشروع أحدث', updatedAt: new Date('2026-11-18T12:00:00Z') },
    ];
    window.history.replaceState({}, '', '/projects/project-newer/workspace');
    render(<Router><Shell><div>Current page</div></Shell></Router>);

    const recentProject = screen.getByTestId('link-recent-project');
    expect(recentProject).toHaveAttribute('href', '/projects/project-newer/workspace');
    expect(recentProject).toHaveAttribute('aria-current', 'page');
    expect(recentProject).toHaveAccessibleName('افتح مساحة العمل لمشروع مشروع أحدث');
    expect(recentProject).toHaveTextContent('مشروع أحدث');
    expect(screen.queryByText('مشروع أقدم')).not.toBeInTheDocument();
  });

  it('does not show a stale quick link when no projects are available', () => {
    mocks.projects.data = [];
    render(<Router><Shell><div>Current page</div></Shell></Router>);

    expect(screen.queryByTestId('link-recent-project')).not.toBeInTheDocument();
    expect(screen.getByTestId('link-nav-projects')).toHaveAttribute('href', '/projects');
  });

  it('has no axe violations with navigation closed or open', async () => {
    const { container } = render(
      <Router>
        <Shell><div>Current page</div></Shell>
      </Router>,
    );

    const rules = { 'color-contrast': { enabled: false } };
    const closedResults = await axe.run(container, { rules });
    expect(closedResults.violations.map(({ id }) => id)).toEqual([]);

    fireEvent.click(screen.getByRole('button', { name: 'فتح القائمة' }));
    await screen.findByRole('dialog', { name: 'قائمة التنقل الرئيسية' });
    const openResults = await axe.run(container, { rules });
    expect(openResults.violations.map(({ id }) => id)).toEqual([]);
  });

  it('traps keyboard focus, closes with Escape, and restores focus to the opener', async () => {
    render(
      <Router>
        <Shell><div>Current page</div></Shell>
      </Router>,
    );

    const opener = screen.getByRole('button', { name: 'فتح القائمة' });
    expect(opener).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(opener);

    const drawer = await screen.findByRole('dialog', { name: 'قائمة التنقل الرئيسية' });
    expect(drawer).toHaveAttribute('aria-modal', 'true');
    expect(opener).toHaveAttribute('aria-expanded', 'true');
    expect(document.body.style.overflow).toBe('hidden');
    expect(screen.getByTestId('button-close-navigation')).toHaveFocus();

    opener.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(drawer.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).not.toBe(opener);

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(await screen.findByRole('button', { name: 'فتح القائمة' })).toHaveFocus();
    expect(drawer).not.toHaveAttribute('aria-modal', 'true');
    expect(opener).toHaveAttribute('aria-expanded', 'false');
    expect(document.body.style.overflow).toBe('');
  });

  it('keeps technical navigation optional and its existing links available when expanded', () => {
    render(<Router><Shell><div>Current page</div></Shell></Router>);
    const groupButton = screen.getByTestId('button-nav-group-execution');
    const content = document.getElementById('navigation-group-execution')!;
    expect(groupButton).toHaveAttribute('aria-expanded', 'false');
    expect(content).toHaveAttribute('hidden');
    fireEvent.click(groupButton);
    expect(groupButton).toHaveAttribute('aria-expanded', 'true');
    expect(content).not.toHaveAttribute('hidden');
    expect(screen.getByTestId('link-nav-missions')).toHaveTextContent('الأهداف');
    expect(screen.getByTestId('link-nav-missions')).toHaveAttribute('href', '/missions');
    fireEvent.click(groupButton);
    expect(content).toHaveAttribute('hidden');
  });

  it('opens the owning group for a direct technical route but still lets the user collapse it', () => {
    window.history.replaceState({}, '', '/mission-control');
    render(<Router><Shell><div>Technical content</div></Shell></Router>);
    const groupButton = screen.getByTestId('button-nav-group-execution');
    expect(groupButton).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByTestId('link-nav-mission-control')).toHaveAttribute('aria-current', 'page');
    expect(screen.getByTestId('text-current-page')).toHaveTextContent('متابعة الأهداف');
    fireEvent.click(groupButton);
    expect(groupButton).toHaveAttribute('aria-expanded', 'false');
  });

  it('shows the current location for general conversations and project workspaces', () => {
    window.history.replaceState({}, '', '/general-chat?sessionId=session-1');
    const view = render(<Router><Shell><div>General conversation</div></Shell></Router>);
    expect(screen.getByTestId('text-current-page')).toHaveTextContent('محادثة عامة');

    view.unmount();
    window.history.replaceState({}, '', '/projects/project-1/workspace');
    render(<Router><Shell><div>Project workspace</div></Shell></Router>);
    expect(screen.getByTestId('text-current-page')).toHaveTextContent('مساحة المشروع');
  });

  it('isolates RTL navigation from existing page content and preserves the sign-out handoff', () => {
    render(<Router><Shell><div>Technical content</div></Shell></Router>);
    fireEvent.click(screen.getByTestId('button-open-navigation'));
    const drawer = screen.getByRole('dialog', { name: 'قائمة التنقل الرئيسية' });
    expect(drawer).toHaveAttribute('dir', 'rtl');
    expect(drawer).toHaveAttribute('lang', 'ar');
    expect(drawer.className).toContain('right-0');
    expect(screen.getByRole('main')).toHaveAttribute('dir', 'ltr');
    fireEvent.click(screen.getByRole('button', { name: 'تسجيل الخروج' }));
    expect(mocks.signOut).toHaveBeenCalledTimes(1);
    expect(mocks.signOut).toHaveBeenCalledWith({ redirectUrl: expect.any(String) });
  });
});