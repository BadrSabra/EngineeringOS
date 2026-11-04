import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import SignInPage from './SignIn';

vi.mock('@/lib/clerk', () => ({ basePath: '/dashboard' }));
vi.mock('@clerk/react', async () => {
  const ReactModule = await import('react');
  return {
    SignIn: (props: Record<string, string>) =>
      ReactModule.createElement('div', {
        'data-testid': 'clerk-sign-in',
        'data-path': props.path,
        'data-sign-up-url': props.signUpUrl,
        'data-routing': props.routing,
      }),
  };
});

describe('SignInPage', () => {
  it('mounts Clerk with the dashboard-prefixed sign-in and sign-up routes', () => {
    render(<SignInPage />);
    const widget = screen.getByTestId('clerk-sign-in');

    expect(widget).toHaveAttribute('data-routing', 'path');
    expect(widget).toHaveAttribute('data-path', '/dashboard/sign-in');
    expect(widget).toHaveAttribute('data-sign-up-url', '/dashboard/sign-up');
  });
});
