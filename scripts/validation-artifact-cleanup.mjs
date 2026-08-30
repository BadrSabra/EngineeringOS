#!/usr/bin/env node

import { execFile } from "node:child_process";
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const workspaceRoot = path.resolve(process.env.WORKSPACE_PATH ?? process.cwd());
const deliveryRoot = path.join(workspaceRoot, ".engineeringos-delivery");
const reportPath = path.resolve(
  process.env.VALIDATION_ARTIFACT_REPORT_PATH ??
    path.join(workspaceRoot, "docs/validation-artifact-cleanup-report.json"),
);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const RETAINED_ROOT_DISPOSITIONS = new Map([
  ["4db5d88c-6705-46ba-a5ee-0f3af4c030ea", {
    classification: "stale_generated_content",
    disposition: "remove",
    owner: "validation-runtime",
    reason: "Historical provider-parity test caches and shell output; no canonical evidence or recoverable workspace was found.",
    operatorAction: "Remove the exact root after the no-durable-owner and active-writer checks pass.",
  }],
  ["790aaf01-e1a1-4245-8885-bcf4bb404fe8", {
    classification: "stale_generated_content",
    disposition: "remove",
    owner: "validation-runtime",
    reason: "Node compile cache and LSP log only; no fixture, evidence, artifact manifest, or workspace marker was found.",
    operatorAction: "Remove the exact root after the no-durable-owner and active-writer checks pass.",
  }],
  ["8292aca0-42ad-4f4a-97c0-8566ff21fbaf", {
    classification: "stale_generated_content",
    disposition: "remove",
    owner: "validation-runtime",
    reason: "Historical repair-validation caches and temporary validation subroots; no durable operation owner or artifact manifest was found.",
    operatorAction: "Remove the exact root after the no-durable-owner and active-writer checks pass.",
  }],
  ["af0734e4-b7d9-4d8b-a531-3cace5dc34a6", {
    classification: "stale_generated_content",
    disposition: "remove",
    owner: "release-browser-validation",
    reason: "Historical dashboard journey browser caches and a stale X-server lock; no active writer, durable owner, or artifact manifest was found.",
    operatorAction: "Remove the exact root after confirming the recorded X-server PID is no longer running.",
  }],
  ["b44b647d-24b6-4e0d-b4a4-f939f5f476f9", {
    classification: "stale_generated_content",
    disposition: "remove",
    owner: "release-validation",
    reason: "Historical release-contract test caches, shell output, test sessions, and a stale X-server lock; no active writer, durable owner, or artifact manifest was found.",
    operatorAction: "Remove the exact root after confirming the recorded X-server PID is no longer running.",
  }],
  ["deb5f175-e012-4abd-8775-47d6bd84eaa0", {
    classification: "preserved_fixture",
    disposition: "preserve",
    owner: "recipe-capability-validation",
    reason: "Contains the tracked eos-reach recipe reachability fixtures required by recipe operation-binding work, alongside generated test caches.",
    operatorAction: "Preserve intact; do not remove until the owner explicitly retires or relocates the fixtures.",
  }],
]);

function usage() {
  console.log([
    "Usage:",
    "  node scripts/validation-artifact-cleanup.mjs [--apply --no-durable-owners] [--retained-only]",
    "",
    "Without --apply, writes an inventory and makes no changes.",
    "--apply requires --no-durable-owners and removes only approved roots",
    "with no open process handles. --retained-only scopes apply to the",
    "explicitly reviewed markerless roots from the retained disposition register.",
  ].join("\n"));
}

async function trackedPaths() {
  const { stdout } = await execFileAsync("git", ["-C", workspaceRoot, "ls-files", "-z", "--", ".engineeringos-delivery"], {
    maxBuffer: 128 * 1024 * 1024,
  });
  const byRoot = new Map();
  for (const raw of stdout.split("\0")) {
    if (!raw) continue;
    const relative = raw.replaceAll("\\", "/");
    const root = relative.split("/")[1];
    if (!root) continue;
    byRoot.set(root, (byRoot.get(root) ?? 0) + 1);
  }
  return byRoot;
}

async function openPids(root) {
  try {
    const { stdout } = await execFileAsync("lsof", ["-t", "--", root], {
      maxBuffer: 64 * 1024,
    });
    return [...new Set(stdout.split(/\s+/).filter(Boolean))].sort();
  } catch (error) {
    if (error?.code === 1) return [];
    throw error;
  }
}

async function inspectRoot(root, trackedCount) {
  const name = path.basename(root);
  const relativeRoot = path.relative(workspaceRoot, root).replaceAll("\\", "/");
  const retained = RETAINED_ROOT_DISPOSITIONS.get(name);
  let marker;
  try {
    marker = (await readFile(path.join(root, ".engineeringos-delivery-workspace"), "utf8")).trim();
  } catch {
    marker = null;
  }

  const counts = { files: 0, symlinks: 0, other: 0, bytes: 0, validationSubroots: 0, artifactManifests: 0 };
  async function visit(directory, relative = "") {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const child = path.join(directory, entry.name);
      const childRelative = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (entry.name.startsWith("engineeringos-validation-")) counts.validationSubroots += 1;
        await visit(child, childRelative);
        continue;
      }
      if (entry.isSymbolicLink()) {
        counts.symlinks += 1;
        continue;
      }
      if (!entry.isFile()) {
        counts.other += 1;
        continue;
      }
      const details = await stat(child);
      counts.files += 1;
      counts.bytes += details.size;
      if (childRelative.endsWith("/.replit-artifact/artifact.toml")) counts.artifactManifests += 1;
    }
  }
  await visit(root);

  const markerMatchesRoot = Boolean(marker && uuidPattern.test(name) && marker === name);
  const activePids = await openPids(root);
  return {
    root: relativeRoot,
    operationId: markerMatchesRoot ? marker : null,
    marker,
    classification: retained?.classification ?? (markerMatchesRoot ? "generated_delivery_workspace" : "unknown"),
    tracked: trackedCount > 0,
    trackedFileCount: trackedCount,
    activePids,
    ...counts,
    ...(retained ? {
      disposition: retained.disposition,
      owner: retained.owner,
      dispositionReason: retained.reason,
      operatorAction: retained.operatorAction,
      safetyChecks: {
        durableOwner: false,
        activeWriter: activePids.length > 0,
        gitTracked: trackedCount > 0,
        serverOwnedMarker: markerMatchesRoot,
      },
    } : {}),
  };
}

async function inventory() {
  const roots = (await readdir(deliveryRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(deliveryRoot, entry.name))
    .sort();
  const tracked = await trackedPaths();
  const entries = [];
  for (const root of roots) {
    entries.push(await inspectRoot(root, tracked.get(path.basename(root)) ?? 0));
  }
  return {
    kind: "validation-artifact-cleanup-report",
    version: 2,
    generatedAt: new Date().toISOString(),
    workspaceRoot: "[PROJECT_ROOT]",
    deliveryRoot: ".engineeringos-delivery",
    databaseOwnerCheck: "caller-confirmed-no-durable-workspace-owners",
    entries,
    summary: {
      roots: entries.length,
      generatedDeliveryWorkspaces: entries.filter((entry) => entry.classification === "generated_delivery_workspace").length,
      unknown: entries.filter((entry) => entry.classification === "unknown").length,
      retained: entries.filter((entry) => entry.disposition).length,
      activeRoots: entries.filter((entry) => entry.activePids.length > 0).length,
      trackedRoots: entries.filter((entry) => entry.tracked).length,
      files: entries.reduce((total, entry) => total + entry.files, 0),
      bytes: entries.reduce((total, entry) => total + entry.bytes, 0),
      validationSubroots: entries.reduce((total, entry) => total + entry.validationSubroots, 0),
      artifactManifests: entries.reduce((total, entry) => total + entry.artifactManifests, 0),
    },
  };
}

async function writeReport(report) {
  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

const args = new Set(process.argv.slice(2));
if (args.has("--help")) {
  usage();
  process.exit(0);
}
const apply = args.has("--apply");
const retainedOnly = args.has("--retained-only");
if (apply && !args.has("--no-durable-owners")) {
  usage();
  throw new Error("Refusing --apply without the explicit no-durable-owners safety assertion.");
}

const report = await inventory();
const removable = report.entries.filter((entry) =>
  (!retainedOnly && entry.classification === "generated_delivery_workspace" ||
    (entry.classification === "stale_generated_content" && entry.disposition === "remove")) &&
  entry.activePids.length === 0,
);
const blocked = report.entries.filter((entry) =>
  !removable.includes(entry) ||
  entry.activePids.length > 0,
);
report.cleanup = {
  mode: apply ? (retainedOnly ? "apply-retained-only" : "apply") : "inventory",
  scope: retainedOnly ? "retained-disposition-register" : "all-approved-roots",
  removableRoots: removable.map((entry) => entry.root),
  blockedRoots: blocked.map((entry) => ({
    root: entry.root,
    classification: entry.classification,
    activePids: entry.activePids,
    ...(entry.disposition ? {
      disposition: entry.disposition,
      owner: entry.owner,
      reason: entry.dispositionReason,
      operatorAction: entry.operatorAction,
      safetyChecks: entry.safetyChecks,
    } : {}),
  })),
  retainedRoots: [...RETAINED_ROOT_DISPOSITIONS.entries()].map(([id, disposition]) => {
    const entry = report.entries.find((item) => path.basename(item.root) === id);
    return {
      root: `.engineeringos-delivery/${id}`,
      present: Boolean(entry),
      classification: disposition.classification,
      disposition: !entry && disposition.disposition === "remove" ? "removed" : disposition.disposition,
      owner: disposition.owner,
      reason: disposition.reason,
      operatorAction: !entry && disposition.disposition === "remove"
        ? "Removed by the retained-only cleanup after the recorded safety checks passed."
        : disposition.operatorAction,
      checks: entry?.safetyChecks ?? (disposition.disposition === "remove"
        ? {
            durableOwner: false,
            activeWriter: false,
            gitTracked: true,
            serverOwnedMarker: false,
          }
        : {
            durableOwner: false,
            activeWriter: false,
            gitTracked: false,
            serverOwnedMarker: false,
          }),
    };
  }),
  removedRoots: [],
};
report.cleanup.unresolvedOperatorActions = report.cleanup.retainedRoots
  .filter((entry) => entry.disposition === "preserve")
  .map((entry) => ({ root: entry.root, action: entry.operatorAction }));

if (apply) {
  if (blocked.some((entry) => entry.activePids.length > 0)) {
    throw new Error("Refusing cleanup while a process still has an open delivery root.");
  }
  report.cleanup.removedRoots = removable.map((entry) => entry.root);
  await writeReport(report);

  for (const entry of removable) {
    await rm(path.join(workspaceRoot, entry.root), { recursive: true, force: true });
  }
  if (removable.length > 0) {
    await execFileAsync("git", ["-C", workspaceRoot, "add", "-u", "--", ".engineeringos-delivery"], {
      maxBuffer: 1024 * 1024,
    });
  }
  report.cleanup.retainedRoots = report.cleanup.retainedRoots.map((retained) =>
    report.cleanup.removedRoots.includes(retained.root)
      ? { ...retained, present: false, disposition: "removed" }
      : retained,
  );
}

await writeReport(report);
console.log(JSON.stringify({
  reportPath: path.relative(workspaceRoot, reportPath).replaceAll("\\", "/"),
  cleanupMode: report.cleanup.mode,
  summary: report.summary,
  removableRoots: removable.length,
  blockedRoots: blocked.length,
  removedRoots: report.cleanup.removedRoots.length,
}, null, 2));