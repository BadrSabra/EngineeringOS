import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ProjectWorkspaceSwitcher from './ProjectWorkspaceSwitcher';

const mocks = vi.hoisted(() => ({
  projectsQuery: {
    data: [] as Array<{ id: string; name: string }>,
    isLoading: false,
    isError: false,
    isFetching: false,
    refetch: vi.fn(),
  },
}));

vi.mock('@workspace/api-client-react', () => ({
  getListProjectsQueryKey: vi.fn(() => ['/api/projects']),
  useListProjects: vi.fn(() => mocks.projectsQuery),
}));

vi.mock('wouter', () => ({
  Link: ({
    href,
    children,
    ...props
  }: {
    href: string;
    children: React.ReactNode;
    [key: string]: unknown;
  }) => <a href={href} {...props}>{children}</a>,
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.projectsQuery.data = [
    { id: 'project-1', name: 'بوابة العملاء' },
    { id: 'project/2', name: 'لوحة الإدارة' },
  ];
  mocks.projectsQuery.isLoading = false;
  mocks.projectsQuery.isError = false;
  mocks.projectsQuery.isFetching = false;
});

describe('Project workspace project switcher', () => {
  it('shows only other owned projects and links to each workspace', () => {
    render(
      <ProjectWorkspaceSwitcher
        currentProjectId="project-1"
        currentProjectName="بوابة العملاء"
      />,
    );

    expect(screen.getByTestId('button-workspace-project-switcher')).toHaveTextContent('بوابة العملاء');
    expect(screen.queryByTestId('link-switch-workspace-project-project-1')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('button-workspace-project-switcher'));

    expect(screen.getByTestId('link-switch-workspace-project-project/2')).toHaveAttribute(
      'href',
      '/projects/project%2F2/workspace',
    );
    expect(screen.getByTestId('link-all-workspace-projects')).toHaveAttribute('href', '/projects');
  });

  it('keeps the current project as plain text when there is no other project', () => {
    mocks.projectsQuery.data = [{ id: 'project-1', name: 'بوابة العملاء' }];
    render(
      <ProjectWorkspaceSwitcher
        currentProjectId="project-1"
        currentProjectName="بوابة العملاء"
      />,
    );

    expect(screen.getByTestId('text-current-workspace-project')).toHaveTextContent('بوابة العملاء');
    expect(screen.queryByTestId('button-workspace-project-switcher')).not.toBeInTheDocument();
  });

  it('does not offer another project when the project list failed and retries only that read', () => {
    mocks.projectsQuery.isError = true;
    render(
      <ProjectWorkspaceSwitcher
        currentProjectId="project-1"
        currentProjectName="بوابة العملاء"
      />,
    );

    expect(screen.getByRole('status')).toHaveTextContent('تعذر تحميل المشاريع الأخرى');
    fireEvent.click(screen.getByTestId('button-retry-project-switcher'));
    expect(mocks.projectsQuery.refetch).toHaveBeenCalledOnce();
    expect(screen.queryByTestId('link-switch-workspace-project-project/2')).not.toBeInTheDocument();
  });

  it('fails closed when the current project is absent from the account project list', () => {
    mocks.projectsQuery.data = [{ id: 'another-project', name: 'مشروع آخر' }];
    render(
      <ProjectWorkspaceSwitcher
        currentProjectId="project-1"
        currentProjectName="بوابة العملاء"
      />,
    );

    expect(screen.getByTestId('text-current-workspace-project')).toHaveTextContent('بوابة العملاء');
    expect(screen.getByRole('status')).toHaveTextContent('تعذر التحقق من قائمة المشاريع الأخرى');
    expect(screen.queryByTestId('button-workspace-project-switcher')).not.toBeInTheDocument();
    expect(screen.queryByText('مشروع آخر')).not.toBeInTheDocument();
  });
});
