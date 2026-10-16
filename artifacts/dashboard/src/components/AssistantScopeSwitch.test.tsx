import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AssistantScopeSwitch } from './AssistantScopeSwitch';

beforeEach(() => {
  window.history.replaceState({}, '', '/general-chat');
});

describe('assistant scope switch', () => {
  it('returns from general chat to project selection without choosing a project silently', () => {
    render(<AssistantScopeSwitch currentScope="general" />);

    const link = screen.getByRole('link', { name: 'اختر مشروعًا' });
    expect(link).toHaveAttribute('href', '/');
    expect(link).toHaveAttribute('title', 'العودة لاختيار مشروع قبل بدء العمل داخله');
  });

  it('requires confirmation before leaving unsent text in the current scope', () => {
    const confirmation = vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<AssistantScopeSwitch currentScope="general" hasUnsentMessage />);

    fireEvent.click(screen.getByRole('link', { name: 'اختر مشروعًا' }));

    expect(confirmation).toHaveBeenCalledWith(
      'تبديل مساحة المساعد سيغادر النص غير المرسل هذه الصفحة. هل تريد المتابعة؟',
    );
    expect(window.location.pathname).toBe('/general-chat');
    confirmation.mockRestore();
  });

  it('opens a project-free general chat from project work', () => {
    render(<AssistantScopeSwitch currentScope="project" />);

    const link = screen.getByRole('link', { name: 'اسأل سؤالًا عامًا' });
    expect(link).toHaveAttribute('href', '/general-chat');
    expect(link.getAttribute('href')).not.toContain('projectId');
    expect(link.getAttribute('href')).not.toContain('sessionId');
  });
});
