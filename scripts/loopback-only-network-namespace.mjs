import { readFileSync, readlinkSync } from "node:fs";
import { createServer } from "node:net";
import { networkInterfaces } from "node:os";

function normalizedRoutes(routeText, family) {
  const lines = routeText
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
  const entries = family === "ipv4" ? lines.slice(1) : lines;
  return entries.map((line) => {
    const fields = line.split(/\s+/u);
    if (family === "ipv4") {
      return {
        iface: fields[0],
        destination: fields[1],
        isDefault: fields[1] === "00000000",
      };
    }
    return {
      iface: fields.at(-1),
      destination: fields[0],
      isDefault:
        fields[0] === "00000000000000000000000000000000"
        && fields[1] === "00",
    };
  });
}

export function inspectLoopbackOnlyNetworkSnapshot(snapshot) {
  const reasons = [];
  if (!snapshot.selfNetNamespace || !snapshot.hostNetNamespace) {
    reasons.push("network_namespace_identity_unavailable");
  } else if (snapshot.selfNetNamespace === snapshot.hostNetNamespace) {
    reasons.push("process_shares_host_network_namespace");
  }

  const interfaces = Array.isArray(snapshot.interfaces) ? snapshot.interfaces : [];
  if (interfaces.length !== 1 || interfaces[0] !== "lo") {
    reasons.push("non_loopback_network_interface_present");
  }

  for (const route of [...(snapshot.ipv4Routes ?? []), ...(snapshot.ipv6Routes ?? [])]) {
    if (route.iface !== "lo") reasons.push("route_uses_non_loopback_interface");
    if (route.isDefault) reasons.push("default_route_present");
  }
  if (snapshot.ipv4Routes === undefined || snapshot.ipv6Routes === undefined) {
    reasons.push("route_table_unavailable");
  }

  return { ok: reasons.length === 0, reasons: [...new Set(reasons)] };
}

export function readLoopbackOnlyNetworkSnapshot({
  expectedHostNetNamespace = process.env.ENGINEERINGOS_EXPECTED_HOST_NET_NAMESPACE,
  readHostPid1Namespace = () => readlinkSync("/proc/1/ns/net"),
} = {}) {
  const attempt = (read) => {
    try {
      return read();
    } catch {
      return undefined;
    }
  };
  const hostNetNamespace = expectedHostNetNamespace === undefined
    ? attempt(readHostPid1Namespace)
    : /^net:\[\d+\]$/u.test(expectedHostNetNamespace)
      ? expectedHostNetNamespace
      : undefined;
  const ipv4RouteText = attempt(() => readFileSync("/proc/net/route", "utf8"));
  const ipv6RouteText = attempt(() => readFileSync("/proc/net/ipv6_route", "utf8"));
  return {
    selfNetNamespace: attempt(() => readlinkSync("/proc/self/ns/net")),
    hostNetNamespace,
    // sysfs may be mounted from the parent container and therefore expose
    // parent interfaces inside an unshared network namespace. Node resolves
    // these addresses in the current process's network namespace instead.
    interfaces: attempt(() => Object.keys(networkInterfaces())),
    ipv4Routes: ipv4RouteText === undefined
      ? undefined
      : normalizedRoutes(ipv4RouteText, "ipv4"),
    ipv6Routes: ipv6RouteText === undefined
      ? undefined
      : normalizedRoutes(ipv6RouteText, "ipv6"),
  };
}

function probeIPv6LoopbackSupport() {
  return new Promise((resolve) => {
    const server = createServer();
    let settled = false;
    const finish = (supported) => {
      if (settled) return;
      settled = true;
      resolve(supported);
    };
    server.once("error", (error) => {
      if (error?.code === "EAFNOSUPPORT" || error?.code === "EPROTONOSUPPORT") {
        finish(false);
      } else {
        // An unavailable address or another probe failure is not proof that
        // IPv6 is disabled. Keep the missing route table as a hard failure.
        finish(undefined);
      }
    });
    server.listen({ host: "::1", port: 0 }, () => {
      server.close(() => finish(true));
    });
  });
}

export async function assertLoopbackOnlyNetworkNamespace({
  readSnapshot = readLoopbackOnlyNetworkSnapshot,
  probeIPv6 = probeIPv6LoopbackSupport,
} = {}) {
  let snapshot = readSnapshot();
  if (snapshot.ipv6Routes === undefined && await probeIPv6() === false) {
    // Missing IPv6 procfs routes are accepted only when the kernel rejects a
    // local IPv6 bind with EAFNOSUPPORT/EPROTONOSUPPORT.
    snapshot = { ...snapshot, ipv6Routes: [] };
  }
  const result = inspectLoopbackOnlyNetworkSnapshot(snapshot);
  if (!result.ok) {
    throw new Error(
      `Lifecycle run blocked before API startup: OS network isolation is not loopback-only (${result.reasons.join(", ")}).`,
    );
  }
  return result;
}
