import { promises as fs } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
// no-op harness; just reuse via dynamic import in a real vitest run below
