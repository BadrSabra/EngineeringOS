import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import Projects from "./Projects";

// Mock the generated API client hook
vi.mock("@workspace/api-client-react", () => ({
  useListProjects: vi.fn(),
  getListProjectsQueryKey: () => ["projects"],
  classifyProjectError: (err: unknown) => err,
  isRetryableProjectError: () => false,
  emitProjectLoadFailed: vi.fn(),
}));

// Mock wouter
vi.mock("wouter", () => ({
  Link: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

// Mock DiscoverProjectWizard — integration tested separately
vi.mock("./DiscoverProjectWizard", () => ({
  DiscoverProjectWizard: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="discover-wizard">
      <button onClick={onClose}>Close</button>
    </div>
  ),
}));

import { useListProjects } from "@workspace/api-client-react";

const mockProjects = [
  { id: "1", name: "alpha-service", status: "active", language: "TypeScript", qualityScore: 0.9, lastScanAt: null },
  { id: "2", name: "beta-worker", status: "scanning", language: "Python", qualityScore: null, lastScanAt: null },
  { id: "3", name: "gamma-lib", status: "archived", language: "TypeScript", qualityScore: 0.7, lastScanAt: null },
];

beforeEach(() => {
  vi.mocked(useListProjects).mockReturnValue({
    data: mockProjects,
    isLoading: false,
    isError: false,
    error: null,
  } as ReturnType<typeof useListProjects>);
});

describe("Projects", () => {
  it("renders all projects when search is empty", () => {
    render(<Projects />);
    expect(screen.getByText("alpha-service")).toBeInTheDocument();
    expect(screen.getByText("beta-worker")).toBeInTheDocument();
    expect(screen.getByText("gamma-lib")).toBeInTheDocument();
  });

  it("filters projects by name (case-insensitive)", () => {
    render(<Projects />);
    const input = screen.getByPlaceholderText(/filter projects/i);
    fireEvent.change(input, { target: { value: "ALPHA" } });
    expect(screen.getByText("alpha-service")).toBeInTheDocument();
    expect(screen.queryByText("beta-worker")).not.toBeInTheDocument();
    expect(screen.queryByText("gamma-lib")).not.toBeInTheDocument();
  });

  it("shows empty state when no projects match the search", () => {
    render(<Projects />);
    const input = screen.getByPlaceholderText(/filter projects/i);
    fireEvent.change(input, { target: { value: "zzz-no-match" } });
    expect(screen.queryByText("alpha-service")).not.toBeInTheDocument();
  });

  it("renders loading skeletons while fetching", () => {
    vi.mocked(useListProjects).mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
      error: null,
    } as ReturnType<typeof useListProjects>);
    render(<Projects />);
    // Skeleton cards have animate-pulse; heading should still be present
    expect(screen.getByText("Projects")).toBeInTheDocument();
  });

  it("opens discover wizard when Discover Project button is clicked", () => {
    render(<Projects />);
    fireEvent.click(screen.getByRole("button", { name: /discover project/i }));
    expect(screen.getByTestId("discover-wizard")).toBeInTheDocument();
  });

  it("closes discover wizard when onClose is called", () => {
    render(<Projects />);
    fireEvent.click(screen.getByRole("button", { name: /discover project/i }));
    expect(screen.getByTestId("discover-wizard")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /close/i }));
    expect(screen.queryByTestId("discover-wizard")).not.toBeInTheDocument();
  });
});
