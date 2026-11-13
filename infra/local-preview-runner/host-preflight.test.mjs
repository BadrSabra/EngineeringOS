import assert from "node:assert/strict";
import test from "node:test";
import { buildHostPreflight } from "./host-preflight.mjs";

function baseline(overrides = {}) {
  const files = new Map([
    ["/sys/fs/cgroup/cgroup.controllers", "cpu memory pids"],
    ["/sys/kernel/security/lsm", "capability,landlock,yama"],
    ["/proc/sys/user/max_user_namespaces", "28633"],
    ["/proc/sys/kernel/unprivileged_userns_clone", "1"],
  ]);
  return buildHostPreflight({
    platform: "linux",
    architecture: "x64",
    kernelRelease: "test-kernel",
    uid: 1000,
    readText: (filePath) => files.get(filePath) ?? null,
    exists: (filePath) => filePath === "/dev/kvm",
    isCharacterDevice: () => true,
    canReadWrite: () => true,
    hasExecutable: (command) =>
      ["runsc", "firecracker", "jailer"].includes(command),
    ...overrides,
  });
}

test("reports detected host facts but never qualifies a Runner", () => {
  const report = baseline();
  assert.equal(report.classification, "diagnostic_only_not_qualification");
  assert.equal(report.kernelFeatures.cgroupV2, true);
  assert.equal(report.kernelFeatures.landlockListedInLsm, true);
  assert.equal(report.kernelFeatures.kvmDevice.accessible, true);
  assert.equal(report.runtimes.runsc, true);
  assert.equal(report.candidateExecutionAllowed, false);
  assert.ok(
    report.blockers.includes(
      "independent_runtime_policy_and_security_qualification_required",
    ),
  );
});

test("fails closed when a stronger runtime or cgroup evidence is absent", () => {
  const report = baseline({
    readText: () => null,
    exists: () => false,
    hasExecutable: (command) => command === "runc",
  });
  assert.equal(report.kernelFeatures.cgroupV2, false);
  assert.equal(report.kernelFeatures.kvmDevice.present, false);
  assert.equal(report.runtimes.runc, true);
  assert.equal(report.candidateExecutionAllowed, false);
  assert.ok(report.blockers.includes("cgroup_v2_not_detected"));
  assert.ok(
    report.blockers.includes(
      "no_candidate_stronger_than_shared_kernel_runtime_detected",
    ),
  );
});

test("does not accept Firecracker when KVM is not accessible by the Agent user", () => {
  const report = baseline({
    exists: () => true,
    isCharacterDevice: () => true,
    canReadWrite: () => false,
    hasExecutable: (command) => command === "firecracker",
  });
  assert.equal(report.kernelFeatures.kvmDevice.present, true);
  assert.equal(report.kernelFeatures.kvmDevice.accessible, false);
  assert.ok(
    report.blockers.includes(
      "firecracker_kvm_unavailable_to_current_user",
    ),
  );
  assert.equal(report.candidateExecutionAllowed, false);
});
