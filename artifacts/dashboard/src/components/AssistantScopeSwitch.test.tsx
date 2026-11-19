import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AssistantScopeSwitch } from './AssistantScopeSwitch';

beforeEach(() => {
  window.history.replaceState({}, '', '/general-chat');
});

describe('assistant scope switch', () => {
  it('searches projects and switches directly when a single result remains', async () => {
    const onSelectProject = vi.fn();
    render(<AssistantScopeSwitch
      currentScope="general"
      projects={[
        { id: 'project-1', name: 'مَتجر الورد' },
        { id: 'project-2', name: 'لوحة التقارير' },
      ]}
      onSelectProject={onSelectProject}
    />);

    const search = screen.getByRole('searchbox', { name: 'ابحث باسم المشروع' });
    fireEvent.change(search, { target: { value: 'متجر الورد' } });
    const selector = screen.getByRole('combobox', { name: 'اختر مشروعًا للعمل داخله' });
    expect(selector).toHaveValue('');
    expect(screen.getByRole('option', { name: 'مَتجر الورد' })).toHaveValue('project-1');
    expect(screen.queryByRole('option', { name: 'لوحة التقارير' })).not.toBeInTheDocument();

    fireEvent.keyDown(search, { key: 'Enter' });
    expect(onSelectProject).toHaveBeenCalledWith('project-1');
    expect(search).toHaveValue('');
  });

  it('does not choose during IME composition and keeps multiple matches explicit', () => {
    const onSelectProject = vi.fn();
    render(<AssistantScopeSwitch
      currentScope="general"
      projects={[
        { id: 'project-1', name: 'مشروع ألف' },
        { id: 'project-2', name: 'مشروع باء' },
      ]}
      onSelectProject={onSelectProject}
    />);

    const search = screen.getByRole('searchbox', { name: 'ابحث باسم المشروع' });
    fireEvent.change(search, { target: { value: 'مشروع ألف' } });
    fireEvent.keyDown(search, { key: 'Enter', isComposing: true });
    expect(onSelectProject).not.toHaveBeenCalled();

    fireEvent.change(search, { target: { value: 'مشروع' } });
    fireEvent.keyDown(search, { key: 'Enter' });
    expect(onSelectProject).not.toHaveBeenCalled();
    expect(screen.getByTestId('status-scope-project-search')).toHaveTextContent(
      'توجد عدة مشاريع. اختر من القائمة.',
    );
    const selector = screen.getByRole('combobox', { name: 'اختر مشروعًا للعمل داخله' });
    fireEvent.change(selector, { target: { value: 'project-2' } });
    expect(onSelectProject).toHaveBeenCalledWith('project-2');
  });

  it('shows an empty search state without changing project scope', () => {
    const onSelectProject = vi.fn();
    render(<AssistantScopeSwitch
      currentScope="general"
      projects={[{ id: 'project-1', name: 'مشروع واحد' }]}
      onSelectProject={onSelectProject}
    />);

    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'غير موجود' } });
    expect(screen.getByTestId('status-scope-project-search')).toHaveTextContent('لم نعثر على مشروع بهذا الاسم');
    expect(onSelectProject).not.toHaveBeenCalled();
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
