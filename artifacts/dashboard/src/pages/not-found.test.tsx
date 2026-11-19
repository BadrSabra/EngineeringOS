import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import NotFound from './not-found';

vi.mock('wouter', () => ({
  Link: ({ href, children, ...props }: {
    href: string;
    children: React.ReactNode;
  } & Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, 'href'>) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

describe('NotFound', () => {
  it('explains the missing page in Arabic and offers clear destinations', () => {
    render(<NotFound />);

    expect(screen.getByRole('main')).toHaveAttribute('dir', 'rtl');
    expect(screen.getByRole('main')).toHaveAttribute('lang', 'ar');
    expect(screen.getByRole('heading', { name: 'لم نعثر على هذه الصفحة' })).toBeInTheDocument();
    expect(screen.getByText('404')).toHaveAttribute('dir', 'ltr');
    expect(screen.getByTestId('link-not-found-projects')).toHaveAttribute('href', '/projects');
    expect(screen.getByTestId('link-not-found-home')).toHaveAttribute('href', '/');
    expect(screen.queryByText(/router|dashboard|not found/i)).not.toBeInTheDocument();
  });
});
