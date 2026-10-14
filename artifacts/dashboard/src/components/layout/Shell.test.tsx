import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Router } from 'wouter';
import { Shell } from './Shell';

const mocks = vi.hoisted(() => ({
  signOut: vi.fn(),
}));

vi.mock('@clerk/react', () => ({
  useUser: () => ({ user: { fullName: 'Test Operator' } }),
  useClerk: () => ({ signOut: mocks.signOut }),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  window.history.replaceState({}, '', '/');
  document.body.style.overflow = '';
});

describe('Shell mobile navigation', () => {
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