#!/usr/bin/env node

import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const workspaceRoot = resolve(import.meta.dirname, "..");
const dashboardOutput = join(
  workspaceRoot,
  "artifacts",
  "dashboard",
  "dist",
  "public",
);
const buildOnlyPlaceholder = "pk_test_build_only_placeholder";

function publicClerkKey() {
  return (
    process.env.VITE_CLERK_PUBLISHABLE_KEY?.trim() ||
    process.env.CLERK_PUBLISHABLE_KEY?.trim() ||
    ""
  );
}

function isPublishableKey(value) {
  return (
    value !== buildOnlyPlaceholder &&
    /^pk_(?:test|live)_[A-Za-z0-9_-]+$/.test(value)
  );
}

async function outputContainsPlaceholder(directory) {
  let entries;

  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    // Release validation can run outside a Dashboard build. The environment
    // check still protects the release path; the deployment post-build hook
    // also has the generated output available for this check.
    if (error?.code === "ENOENT") return false;
    throw error;
  }

  for (const entry of entries) {
    const file = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (await outputContainsPlaceholder(file)) return true;
      continue;
    }

    if ((await readFile(file)).includes(buildOnlyPlaceholder)) return true;
  }

  return false;
}

const key = publicClerkKey();

if (!isPublishableKey(key)) {
  console.error(
    "Dashboard release blocked: a real Clerk publishable key is required; the build-only placeholder is not allowed.",
  );
  process.exit(1);
}

if (await outputContainsPlaceholder(dashboardOutput)) {
  console.error(
    "Dashboard release blocked: the generated Dashboard contains the build-only Clerk placeholder.",
  );
  process.exit(1);
}

console.log("Dashboard Clerk configuration is ready for release.");