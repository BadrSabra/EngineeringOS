import assert from "node:assert/strict";
import test from "node:test";
import { evaluateContainerPreflight } from "./api-only-smoke-container-preflight.mjs";

const isolatedSnapshot = {
  selfNetNamespace: "net:[2002]",
  hostNetNamespace: "net:[1001]",
  interfaces: ["lo"],
  ipv4Routes: [],
  ipv6Routes: [],
};

const restrictedSecurity = {
  capabilities: {
    CapEff: "0",
    CapPrm: "0",
    CapBnd: "0",
    CapAmb: "0",
  },
  noNewPrivileges: true,
};

test("container preflight accepts loopback-only networking and dropped privileges", () => {
  const result = evaluateContainerPreflight({
    snapshot: isolatedSnapshot,
    security: restrictedSecurity,
    uid: 1001,
    childNamespace: isolatedSnapshot.selfNetNamespace,
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.reasons, []);
  assert.equal(result.capabilitiesDropped, true);
  assert.equal(result.childNamespaceMatches, true);
});

test("container preflight rejects network, privilege, and child-namespace gaps", () => {
  const result = evaluateContainerPreflight({
    snapshot: {
      ...isolatedSnapshot,
      interfaces: ["eth0", "lo"],
      ipv4Routes: [{ iface: "eth0", destination: "00000000", isDefault: true }],
    },
    security: {
      ...restrictedSecurity,
      capabilities: { ...restrictedSecurity.capabilities, CapBnd: "200000" },
      noNewPrivileges: false,
    },
    uid: 0,
    childNamespace: "net:[3003]",
  });

  assert.equal(result.ok, false);
  assert.ok(result.reasons.includes("non_loopback_network_interface_present"));
  assert.ok(result.reasons.includes("default_route_present"));
  assert.ok(result.reasons.includes("container_process_is_root"));
  assert.ok(result.reasons.includes("container_capabilities_not_dropped"));
  assert.ok(result.reasons.includes("no_new_privileges_not_enforced"));
  assert.ok(result.reasons.includes("child_network_namespace_not_inherited"));
});

test("container preflight fails closed if the runtime cannot prove a non-root UID", () => {
  const result = evaluateContainerPreflight({
    snapshot: isolatedSnapshot,
    security: restrictedSecurity,
    uid: undefined,
    childNamespace: isolatedSnapshot.selfNetNamespace,
  });

  assert.equal(result.ok, false);
  assert.ok(result.reasons.includes("container_uid_unavailable"));
});
