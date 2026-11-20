import React from 'react';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import NotFound from './not-found';

const routerState = vi.hoisted(() => ({
  pathname: '/unknown-route',
  navigate: vi.fn(),
}));

vi.mock('wouter', () => ({
  Link: ({ href, children, ...props }: {
    href: string;
    children: React.ReactNode;
  } & Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, 'href'>) => (
    <a href={href} {...props}>{children}</a>
  ),
  useLocation: () => [routerState.pathname, routerState.navigate],
}));

describe('NotFound', () => {
  beforeEach(() => {
    routerState.pathname = '/unknown-route';
  });

  it('explains the missing page in Arabic and offers clear destinations', () => {
    render(<NotFound />);

    expect(screen.getByRole('main')).toHaveAttribute('dir', 'rtl');
    expect(screen.getByRole('main')).toHaveAttribute('lang', 'ar');
    expect(screen.getByRole('heading', { name: 'لم نعثر على هذه الصفحة' })).toBeInTheDocument();
    expect(screen.getByText('404')).toHaveAttribute('dir', 'ltr');
    expect(screen.getByTestId('link-not-found-projects')).toHaveAttribute('href', '/projects');
    expect(screen.getByTestId('link-not-found-home')).toHaveAttribute('href', '/');
    expect(screen.queryByTestId('link-not-found-project')).not.toBeInTheDocument();
    expect(screen.queryByText(/router|dashboard|not found/i)).not.toBeInTheDocument();
  });

  it('offers a direct return to the project when a broken route includes its id', () => {
    routerState.pathname = '/projects/project%2Falpha/workspace/old-panel';
    render(<NotFound />);

    const projectLink = screen.getByRole('link', { name: 'العودة إلى هذا المشروع' });
    expect(projectLink).toHaveAttribute('href', '/projects/project%2Falpha');
    expect(screen.getByTestId('link-not-found-projects')).toHaveAttribute('href', '/projects');
  });
});
