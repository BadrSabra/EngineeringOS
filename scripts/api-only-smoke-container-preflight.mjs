#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  inspectLoopbackOnlyNetworkSnapshot,
  readLoopbackOnlyNetworkSnapshot,
} from "./loopback-only-network-namespace.mjs";

const resultsDirectory =
  process.env.ENGINEERINGOS_API_ONLY_SMOKE_RESULTS_DIR
  ?? "/workspace/test-results/api-only-smoke";
const expectedHostNetNamespace =
  process.env.ENGINEERINGOS_EXPECTED_HOST_NET_NAMESPACE;
const capabilityMask = (status, field) => {
  const value = status.match(new RegExp(`^${field}:\\s*([a-f0-9]+)$`, "mu"))?.[1];
  return value === undefined ? undefined : BigInt(`0x${value}`);
};

function readProcessSecurity() {
  const status = readFileSync("/proc/self/status", "utf8");
  const capabilityFields = ["CapEff", "CapPrm", "CapBnd", "CapAmb"];
  const capabilities = Object.fromEntries(
    capabilityFields.map((field) => [field, capabilityMask(status, field)?.toString(16)]),
  );
  const noNewPrivileges = status.match(/^NoNewPrivs:\s*(\d+)$/mu)?.[1] === "1";
  return { capabilities, noNewPrivileges };
}

export function evaluateContainerPreflight({ snapshot, security, uid, childNamespace }) {
  const isolation = inspectLoopbackOnlyNetworkSnapshot(snapshot);
  const capabilityValues = Object.values(security.capabilities);
  const capabilitiesDropped =
    capabilityValues.length === 4
    && capabilityValues.every((value) => value !== undefined && BigInt(`0x${value}`) === 0n);
  const childNamespaceMatches =
    typeof childNamespace === "string"
    && childNamespace.length > 0
    && childNamespace === snapshot.selfNetNamespace;
  const reasons = [...isolation.reasons];
  if (!Number.isInteger(uid)) reasons.push("container_uid_unavailable");
  if (uid === 0) reasons.push("container_process_is_root");
  if (!security.noNewPrivileges) reasons.push("no_new_privileges_not_enforced");
  if (!capabilitiesDropped) reasons.push("container_capabilities_not_dropped");
  if (!childNamespaceMatches) reasons.push("child_network_namespace_not_inherited");
  return {
    ok: reasons.length === 0,
    reasons: [...new Set(reasons)],
    isolation,
    capabilitiesDropped,
    childNamespaceMatches,
  };
}

async function persistEvidence(evidence) {
  await mkdir(resultsDirectory, { recursive: true, mode: 0o700 });
  const destination = path.join(resultsDirectory, "container-network-preflight.json");
  const temporary = `${destination}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(evidence, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await rename(temporary, destination);
}

export async function runContainerPreflight({
  expectedHost = expectedHostNetNamespace,
  uid = typeof process.getuid === "function" ? process.getuid() : undefined,
} = {}) {
  const snapshot = readLoopbackOnlyNetworkSnapshot({
    expectedHostNetNamespace: expectedHost,
  });
  let security;
  let securityError;
  try {
    security = readProcessSecurity();
  } catch (error) {
    security = {
      capabilities: {},
      noNewPrivileges: false,
    };
    securityError = error instanceof Error ? error.message : "process_security_unavailable";
  }
  const child = spawnSync(
    process.execPath,
    ["-e", "process.stdout.write(require('node:fs').readlinkSync('/proc/self/ns/net'))"],
    {
      encoding: "utf8",
      timeout: 5_000,
      maxBuffer: 4_096,
      windowsHide: true,
      env: {
        PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
        HOME: process.env.HOME ?? "/tmp",
      },
    },
  );
  const childNamespace =
    !child.error && child.status === 0 ? child.stdout.trim() : undefined;
  const evaluation = evaluateContainerPreflight({
    snapshot,
    security,
    uid,
    childNamespace,
  });
  const evidence = {
    kind: "engineeringos-api-smoke-container-preflight",
    version: 1,
    expectedHostNetNamespace: expectedHost ?? null,
    snapshot,
    security,
    securityError: securityError ?? null,
    uid: uid ?? null,
    childNamespace: childNamespace ?? null,
    ...evaluation,
    checkedAt: new Date().toISOString(),
  };
  await persistEvidence(evidence);
  if (!evaluation.ok) {
    throw new Error(`container_preflight_failed:${evaluation.reasons.join(",")}`);
  }
  return evidence;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const evidence = await runContainerPreflight();
    console.log(JSON.stringify(evidence));
  } catch (error) {
    console.error(error instanceof Error ? error.message : "container_preflight_failed");
    process.exitCode = 1;
  }
}
