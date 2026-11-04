import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import SignUpPage from './SignUp';

vi.mock('@/lib/clerk', () => ({ basePath: '/dashboard' }));
vi.mock('@clerk/react', async () => {
  const ReactModule = await import('react');
  return {
    SignUp: (props: Record<string, string>) =>
      ReactModule.createElement('div', {
        'data-testid': 'clerk-sign-up',
        'data-path': props.path,
        'data-sign-in-url': props.signInUrl,
        'data-routing': props.routing,
      }),
  };
});

describe('SignUpPage', () => {
  it('mounts Clerk with the dashboard-prefixed sign-up and sign-in routes', () => {
    render(<SignUpPage />);
    const widget = screen.getByTestId('clerk-sign-up');

    expect(widget).toHaveAttribute('data-routing', 'path');
    expect(widget).toHaveAttribute('data-path', '/dashboard/sign-up');
    expect(widget).toHaveAttribute('data-sign-in-url', '/dashboard/sign-in');
  });
});
