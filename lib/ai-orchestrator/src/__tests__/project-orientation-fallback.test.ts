import { describe, expect, it } from "vitest";
import { buildDeterministicProjectOrientationResponse } from "../project-orientation-fallback.js";

const sources = {
  purpose: ["README.md"],
  components: ["src/App.tsx"],
  primaryFlow: ["src/main.tsx"],
  uncertainty: ["tests/app.test.ts"],
};

describe("deterministic project orientation fallback", () => {
  it("assembles a bounded answer from complete role reads", () => {
    const result = buildDeterministicProjectOrientationResponse({
      orientationSources: sources,
      fileContents: new Map([
        ["README.md", "# EngineeringOS\nA workspace dashboard."],
        ["src/App.tsx", "export function App() { return <Dashboard />; }"],
        ["src/main.tsx", "createRoot(document.getElementById('root')!).render(<App />);"],
        ["tests/app.test.ts", "it('renders the dashboard', () => {});"],
      ]),
    });

    expect(result).toBeDefined();
    expect(result?.sources).toEqual([
      "README.md",
      "src/App.tsx",
      "src/main.tsx",
      "tests/app.test.ts",
    ]);
    expect(result?.response).toContain("PROJECT ORIENTATION — deterministic evidence recovery");
    expect(result?.response).toContain("All four orientation roles are covered by 4 complete source reads.");
    expect(result?.response).toContain("Direct evidence:");
    expect(result?.response).toContain("This section records the components named by the retained sources.");
    expect(result?.response).toContain("export function App()");
    expect(result?.response).toContain("createRoot");
    expect(result?.response).not.toContain("The project uses React");
  });

  it("fails closed when any manifest role has no complete read", () => {
    const result = buildDeterministicProjectOrientationResponse({
      orientationSources: sources,
      fileContents: new Map([
        ["README.md", "# EngineeringOS"],
        ["src/App.tsx", "export function App() {}"],
        ["src/main.tsx", "createRoot(...)"],
      ]),
    });

    expect(result).toBeUndefined();
  });

  it("keeps Arabic recovery prose when the request is Arabic", () => {
    const result = buildDeterministicProjectOrientationResponse({
      orientationSources: sources,
      fileContents: new Map([
        ["README.md", "# مشروع"],
        ["src/App.tsx", "export function App() {}"],
        ["src/main.tsx", "createRoot(...)"],
        ["tests/app.test.ts", "it('works', () => {});"],
      ]),
      language: "ar",
    });

    expect(result?.response).toContain("استرداد حتمي من الأدلة");
    expect(result?.response).toContain("المكونات");
    expect(result?.response).toContain("يوثق هذا القسم المكونات التي تسميها المصادر المحتفظ بها.");
    expect(result?.response).toContain("الدليل المباشر:");
  });

  it("adds project-aware navigation questions without treating graph hints as evidence", () => {
    const result = buildDeterministicProjectOrientationResponse({
      orientationSources: sources,
      fileContents: new Map([
        ["README.md", "# EngineeringOS"],
        ["src/App.tsx", "export function App() {}"],
        ["src/main.tsx", "createRoot(...)"],
        ["tests/app.test.ts", "it('works', () => {});"],
      ]),
      message: "Explain the authentication flow and its boundary in src/App.tsx.",
      graphSummary: [
        "Graph entities:",
        "  • AuthController <SERVICE> (src/auth.ts) [91%] {auth}",
        "Graph relationships:",
        "  • AuthController → calls → SessionStore [89%]",
      ].join("\n"),
      explicitPaths: ["src/App.tsx"],
    });

    expect(result?.response).toContain("## Project-aware sub-queries");
    expect(result?.response).toContain(
      "How does authentication move from request entry through identity/session to authorization?",
    );
    expect(result?.response).toContain("What is the integration point between");
    expect(result?.response).toContain(
      "Graph entities and relationships guide navigation only; they are not final evidence.",
    );
  });
});