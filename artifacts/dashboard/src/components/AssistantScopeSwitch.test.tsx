import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AssistantScopeSwitch } from './AssistantScopeSwitch';

beforeEach(() => {
  window.history.replaceState({}, '', '/general-chat');
});

describe('assistant scope switch', () => {
  it('requires an explicit project choice from general chat', () => {
    const onSelectProject = vi.fn();
    render(<AssistantScopeSwitch
      currentScope="general"
      projects={[{ id: 'project-1', name: 'مشروع واحد' }]}
      onSelectProject={onSelectProject}
    />);

    const selector = screen.getByRole('combobox', { name: 'اختر مشروعًا للعمل داخله' });
    expect(selector).toHaveValue('');
    fireEvent.change(selector, { target: { value: 'project-1' } });
    expect(onSelectProject).toHaveBeenCalledWith('project-1');
  });

  it('shows loading, retry, and create-project states from the real project list', () => {
    const onRetryProjects = vi.fn();
    const loadingView = render(<AssistantScopeSwitch currentScope="general" projectsLoading />);
    expect(screen.getByRole('status')).toHaveTextContent('جارٍ تحميل المشاريع');
    loadingView.unmount();

    const errorView = render(<AssistantScopeSwitch currentScope="general" projectsError onRetryProjects={onRetryProjects} />);
    fireEvent.click(screen.getByTestId('button-retry-scope-projects'));
    expect(onRetryProjects).toHaveBeenCalledOnce();
    errorView.unmount();

    render(<AssistantScopeSwitch currentScope="general" projects={[]} />);
    expect(screen.getByRole('link', { name: 'أنشئ مشروعًا' })).toHaveAttribute('href', '/projects?create=1');
  });

  it('can block leaving project scope when the page cannot preserve its draft', () => {
    const onSwitchToGeneral = vi.fn(() => false);
    render(<AssistantScopeSwitch
      currentScope="project"
      generalHref="/general-chat?sessionId=general-1"
      onSwitchToGeneral={onSwitchToGeneral}
    />);

    const link = screen.getByRole('link', { name: 'اسأل سؤالًا عامًا' });
    fireEvent.click(link);
    expect(onSwitchToGeneral).toHaveBeenCalledOnce();
    expect(link).toHaveAttribute('href', '/general-chat?sessionId=general-1');
    expect(window.location.pathname).toBe('/general-chat');
  });

  it('opens a project-free general chat from project work', () => {
    render(<AssistantScopeSwitch currentScope="project" />);

    const link = screen.getByRole('link', { name: 'اسأل سؤالًا عامًا' });
    expect(link).toHaveAttribute('href', '/general-chat');
    expect(link.getAttribute('href')).not.toContain('projectId');
    expect(link.getAttribute('href')).not.toContain('sessionId');
  });
});
