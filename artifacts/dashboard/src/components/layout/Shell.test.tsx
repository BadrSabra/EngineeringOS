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
  document.body.style.overflow = '';
});

describe('Shell mobile navigation', () => {
  it('traps keyboard focus, closes with Escape, and restores focus to the opener', async () => {
    render(
      <Router>
        <Shell><div>Current page</div></Shell>
      </Router>,
    );

    const opener = screen.getByRole('button', { name: 'Open navigation' });
    expect(opener).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(opener);

    const drawer = await screen.findByRole('dialog', { name: 'Main navigation menu' });
    expect(drawer).toHaveAttribute('aria-modal', 'true');
    expect(opener).toHaveAttribute('aria-expanded', 'true');
    expect(document.body.style.overflow).toBe('hidden');
    expect(screen.getByTestId('button-close-navigation')).toHaveFocus();

    const firstFocusable = drawer.querySelector<HTMLElement>('button:not(:disabled)');
    expect(firstFocusable).not.toBeNull();
    firstFocusable?.focus();
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(drawer.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).not.toBe(firstFocusable);

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(await screen.findByRole('button', { name: 'Open navigation' })).toHaveFocus();
    expect(drawer).not.toHaveAttribute('aria-modal', 'true');
    expect(opener).toHaveAttribute('aria-expanded', 'false');
    expect(document.body.style.overflow).toBe('');
  });
});