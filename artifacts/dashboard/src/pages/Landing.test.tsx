import { render, screen, within } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import Landing from "./Landing";

// wouter uses browser APIs — mock it to avoid jsdom limitations
vi.mock("wouter", () => ({
  Link: ({ href, children, className, ...props }: {
    href: string;
    children: React.ReactNode;
    className?: string;
    [key: string]: unknown;
  }) => (
    <a href={href} className={className} {...props}>{children}</a>
  ),
}));

describe("Landing", () => {
  it("renders the product heading", () => {
    render(<Landing />);
    expect(
      screen.getByRole('heading', { level: 1, name: 'ابدأ بهدفك، ونساعدك على متابعة الطريق إليه' }),
    ).toBeInTheDocument();
  });

  it("makes the goal-first route primary and keeps sign in available", () => {
    render(<Landing />);
    const startGoal = screen.getByRole("link", { name: 'ابدأ بهدفك' });
    const signIn = screen.getByRole("link", { name: 'تسجيل الدخول' });
    expect(startGoal).toHaveAttribute("href", "/sign-up");
    expect(startGoal).toHaveAttribute("data-testid", "link-start-goal");
    expect(signIn).toHaveAttribute("href", "/sign-in");
    expect(signIn).toHaveAttribute("data-testid", "link-sign-in");
    expect(screen.queryByRole("link", { name: 'إنشاء حساب' })).not.toBeInTheDocument();
  });

  it("explains the goal-first journey in three clear steps", () => {
    render(<Landing />);

    expect(screen.getByRole('heading', { level: 2, name: 'رحلتك تبدأ بهدفك' })).toBeInTheDocument();
    const steps = screen.getByRole('list', { name: 'خطوات العمل في EngineeringOS' });
    expect(within(steps).getAllByRole('listitem')).toHaveLength(3);
    expect(within(steps).getByText('اكتب هدفك')).toBeInTheDocument();
    expect(within(steps).getByText('تابع الخطوات')).toBeInTheDocument();
    expect(within(steps).getByText('راجع ما اكتمل')).toBeInTheDocument();
    expect(within(steps).getByText(/بيانات التحقق المتاحة/)).toBeInTheDocument();
  });

  it("renders the EngineeringOS brand name in the header", () => {
    render(<Landing />);
    expect(screen.getByText("EngineeringOS")).toBeInTheDocument();
  });

  it('isolates the Latin brand inside an Arabic RTL page and limits the approval wording', () => {
    const { container } = render(<Landing />);
    expect(container.firstElementChild).toHaveAttribute('dir', 'rtl');
    expect(container.firstElementChild).toHaveAttribute('lang', 'ar');
    expect(screen.getByText('EngineeringOS')).toHaveAttribute('dir', 'ltr');
    expect(screen.getByText(/راجع القرارات التي تحتاج موافقتك/)).toBeInTheDocument();
  });
});
