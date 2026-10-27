import assert from "node:assert/strict";
import test from "node:test";
import {
  inspectLoopbackOnlyNetworkSnapshot,
  assertLoopbackOnlyNetworkNamespace,
  readLoopbackOnlyNetworkSnapshot,
} from "./loopback-only-network-namespace.mjs";

const isolatedSnapshot = {
  selfNetNamespace: "net:[1002]",
  hostNetNamespace: "net:[4026531993]",
  interfaces: ["lo"],
  ipv4Routes: [{ iface: "lo", destination: "0000007F", isDefault: false }],
  ipv6Routes: [{ iface: "lo", destination: "00000000000000000000000000000001", isDefault: false }],
};

test("accepts a distinct network namespace with loopback only and no default route", () => {
  assert.deepEqual(inspectLoopbackOnlyNetworkSnapshot(isolatedSnapshot), {
    ok: true,
    reasons: [],
  });
});

test("rejects a process sharing the host network namespace", () => {
  const result = inspectLoopbackOnlyNetworkSnapshot({
    ...isolatedSnapshot,
    selfNetNamespace: isolatedSnapshot.hostNetNamespace,
  });
  assert.equal(result.ok, false);
  assert.ok(result.reasons.includes("process_shares_host_network_namespace"));
});

test("rejects external interfaces and default routes", () => {
  const result = inspectLoopbackOnlyNetworkSnapshot({
    ...isolatedSnapshot,
    interfaces: ["eth0", "lo"],
    ipv4Routes: [
      { iface: "eth0", destination: "00000000", isDefault: true },
    ],
  });
  assert.equal(result.ok, false);
  assert.ok(result.reasons.includes("non_loopback_network_interface_present"));
  assert.ok(result.reasons.includes("route_uses_non_loopback_interface"));
  assert.ok(result.reasons.includes("default_route_present"));
});

test("rejects incomplete route-table evidence", () => {
  const result = inspectLoopbackOnlyNetworkSnapshot({
    ...isolatedSnapshot,
    ipv6Routes: undefined,
  });
  assert.equal(result.ok, false);
  assert.ok(result.reasons.includes("route_table_unavailable"));
});

test("accepts a missing IPv6 route table only when the kernel reports IPv6 unsupported", async () => {
  const result = await assertLoopbackOnlyNetworkNamespace({
    readSnapshot: () => ({ ...isolatedSnapshot, ipv6Routes: undefined }),
    probeIPv6: async () => false,
  });
  assert.deepEqual(result, { ok: true, reasons: [] });
});

test("rejects a missing IPv6 route table when IPv6 support cannot be ruled out", async () => {
  await assert.rejects(
    assertLoopbackOnlyNetworkNamespace({
      readSnapshot: () => ({ ...isolatedSnapshot, ipv6Routes: undefined }),
      probeIPv6: async () => undefined,
    }),
    /route_table_unavailable/u,
  );
});

test("uses a validated host namespace supplied by an isolated container launcher", () => {
  const snapshot = readLoopbackOnlyNetworkSnapshot({
    expectedHostNetNamespace: "net:[4026531993]",
    readHostPid1Namespace: () => {
      throw new Error("container_pid_one_is_not_the_host");
    },
  });
  assert.equal(snapshot.hostNetNamespace, "net:[4026531993]");
});

test("rejects malformed externally supplied namespace identity", () => {
  const snapshot = readLoopbackOnlyNetworkSnapshot({
    expectedHostNetNamespace: "not-a-net-namespace",
    readHostPid1Namespace: () => "net:[4026531993]",
  });
  assert.equal(snapshot.hostNetNamespace, undefined);
  assert.ok(
    inspectLoopbackOnlyNetworkSnapshot(snapshot).reasons
      .includes("network_namespace_identity_unavailable"),
  );
});
