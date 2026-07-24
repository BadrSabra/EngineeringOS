import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import Landing from "./Landing";

// wouter uses browser APIs — mock it to avoid jsdom limitations
vi.mock("wouter", () => ({
  Link: ({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) => (
    <a href={href} className={className}>{children}</a>
  ),
}));

describe("Landing", () => {
  it("renders the product heading", () => {
    render(<Landing />);
    expect(
      screen.getByText("One console for how your code actually moves"),
    ).toBeInTheDocument();
  });

  it("renders Sign In and Create Account CTAs", () => {
    render(<Landing />);
    const signIn = screen.getByRole("link", { name: /sign in/i });
    const createAccount = screen.getByRole("link", { name: /create account/i });
    expect(signIn).toHaveAttribute("href", "/sign-in");
    expect(createAccount).toHaveAttribute("href", "/sign-up");
  });

  it("renders all four feature cards", () => {
    render(<Landing />);
    expect(screen.getByText(/knowledge graph/i)).toBeInTheDocument();
    expect(screen.getByText(/workflow orchestration/i)).toBeInTheDocument();
    expect(screen.getByText(/rule-driven governance/i)).toBeInTheDocument();
    expect(screen.getByText(/live event stream/i)).toBeInTheDocument();
  });

  it("renders the EngineeringOS brand name in the header", () => {
    render(<Landing />);
    expect(screen.getByText("EngineeringOS")).toBeInTheDocument();
  });
});
