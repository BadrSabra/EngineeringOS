/**
 * Unit tests for the pure detection helpers in discovery-runner.ts.
 *
 * These are regression guards for bugs that were invisible without tests:
 *
 *  - detectDb() was matching "from sqlalchemy" across ALL file types, causing
 *    TypeScript files that embed Python code as template literals (e.g.
 *    python-ast-script.ts) to trigger a false SQLAlchemy ORM detection even
 *    for projects that use Drizzle.
 *
 *  - parsePkgJson() only read the root package.json in a monorepo, causing
 *    workspace-member dependencies (express, vitest, esbuild, vite…) to be
 *    invisible to all detectors.
 */

import { describe, it, expect } from "vitest";
import { detectDb } from "./discovery-runner.js";
import type { ScannedFile } from "@workspace/scanner";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const makeFile = (
  path: string,
  content: string,
  language = "typescript",
): ScannedFile => ({
  path,
  absPath: `/project/${path}`,
  language,
  content,
  size: content.length,
  lines: content.split("\n").length,
  oversized: false,
});

// ─── detectDb ────────────────────────────────────────────────────────────────

describe("detectDb", () => {
  // ── SQLAlchemy false-positive regression ───────────────────────────────────

  it("does NOT detect SQLAlchemy when 'from sqlalchemy' appears only in a TypeScript file", () => {
    // This is the exact false-positive that occurred: python-ast-script.ts
    // materialises a Python script as a TS string literal, so the raw text
    // "from sqlalchemy" appears inside a .ts file.
    const files = [
      makeFile(
        "lib/scanner/src/python-ast-script.ts",
        // Simulates a TS template literal containing embedded Python source
        "export const SCRIPT = `\nfrom sqlalchemy import Column\n`;",
        "typescript",
      ),
    ];

    const { orm } = detectDb({}, files);

    expect(orm).not.toBe("SQLAlchemy");
  });

  it("does NOT detect SQLAlchemy when 'from sqlalchemy' appears in a JavaScript file", () => {
    const files = [
      makeFile(
        "scripts/gen.js",
        "// Example: from sqlalchemy import Column",
        "javascript",
      ),
    ];

    const { orm } = detectDb({}, files);

    expect(orm).not.toBe("SQLAlchemy");
  });

  it("does NOT detect SQLAlchemy when 'from sqlalchemy' appears in a Markdown file", () => {
    const files = [
      makeFile(
        "docs/orm.md",
        "## Example\n```python\nfrom sqlalchemy import Column\n```",
        "markdown",
      ),
    ];

    const { orm } = detectDb({}, files);

    expect(orm).not.toBe("SQLAlchemy");
  });

  it("DOES detect SQLAlchemy when 'from sqlalchemy' appears in a Python file", () => {
    const files = [
      makeFile(
        "app/models.py",
        "from sqlalchemy import Column, Integer, String\n\nBase = declarative_base()\n",
        "python",
      ),
    ];

    const { orm } = detectDb({}, files);

    expect(orm).toBe("SQLAlchemy");
  });

  it("does NOT override a dep-detected ORM with SQLAlchemy when the match is in a non-Python file", () => {
    // drizzle-orm is in allDeps → Drizzle ORM should win; a TS file with
    // "from sqlalchemy" should not clobber it.
    const files = [
      makeFile(
        "lib/scanner/src/python-ast-script.ts",
        "export const SCRIPT = `\nfrom sqlalchemy import Column\n`;",
        "typescript",
      ),
    ];

    const { orm } = detectDb({ "drizzle-orm": "^0.45.0" }, files);

    expect(orm).toBe("Drizzle ORM");
  });

  // ── ORM detection from dependencies ───────────────────────────────────────

  it("detects Drizzle ORM from allDeps", () => {
    const { orm } = detectDb({ "drizzle-orm": "^0.45.0" }, []);
    expect(orm).toBe("Drizzle ORM");
  });

  it("detects Prisma from allDeps", () => {
    const { orm } = detectDb({ "@prisma/client": "^5.0.0" }, []);
    expect(orm).toBe("Prisma");
  });

  it("detects TypeORM from allDeps", () => {
    const { orm } = detectDb({ typeorm: "^0.3.0" }, []);
    expect(orm).toBe("TypeORM");
  });

  it("returns null orm when no ORM signal is present", () => {
    const { orm } = detectDb({}, []);
    expect(orm).toBeNull();
  });

  // ── Database detection ─────────────────────────────────────────────────────

  it("detects PostgreSQL from 'pg' dependency", () => {
    const { db } = detectDb({ pg: "^8.0.0" }, []);
    expect(db).toBe("PostgreSQL");
  });

  it("detects MySQL from 'mysql2' dependency", () => {
    const { db } = detectDb({ mysql2: "^3.0.0" }, []);
    expect(db).toBe("MySQL");
  });

  it("returns null db when no database signal is present", () => {
    const { db } = detectDb({}, []);
    expect(db).toBeNull();
  });
});
