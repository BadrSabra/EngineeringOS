import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { delimiter } from "node:path";
import { pathToFileURL } from "node:url";

const readTextFile = (filePath) => {
  try {
    return fs.readFileSync(filePath, "utf8").trim();
  } catch {
    return null;
  }
};

const isExecutable = (command, pathValue) => {
  for (const directory of pathValue.split(delimiter).filter(Boolean)) {
    const candidate = path.join(directory, command);
    try {
      if (fs.statSync(candidate).isFile()) {
        fs.accessSync(candidate, fs.constants.X_OK);
        return true;
      }
    } catch {
      // Continue through PATH without executing the candidate.
    }
  }
  return false;
};

function kvmAvailability({ exists, isCharacterDevice, canReadWrite }) {
  const devicePath = "/dev/kvm";
  let present = false;
  try {
    present = exists(devicePath) && isCharacterDevice(devicePath);
  } catch {
    present = false;
  }
  let accessible = false;
  if (present) {
    try {
      accessible = canReadWrite(devicePath);
    } catch {
      accessible = false;
    }
  }
  return { present, accessible };
}

/**
 * Read-only host diagnostics. This report must never qualify a Runner or
 * authorize Candidate execution; the server requires independent evidence.
 */
export function buildHostPreflight({
  platform = process.platform,
  architecture = os.arch(),
  kernelRelease = os.release(),
  uid = typeof process.getuid === "function" ? process.getuid() : null,
  pathValue = process.env.PATH ?? "",
  readText = readTextFile,
  exists = fs.existsSync,
  isCharacterDevice = (filePath) => fs.statSync(filePath).isCharacterDevice(),
  canReadWrite = (filePath) => {
    fs.accessSync(filePath, fs.constants.R_OK | fs.constants.W_OK);
    return true;
  },
  hasExecutable = (command) => isExecutable(command, pathValue),
} = {}) {
  const cgroupControllers = readText("/sys/fs/cgroup/cgroup.controllers");
  const lsmList = readText("/sys/kernel/security/lsm");
  const maxUserNamespaces = readText("/proc/sys/user/max_user_namespaces");
  const unprivilegedUserNamespaces = readText(
    "/proc/sys/kernel/unprivileged_userns_clone",
  );
  const kvm = kvmAvailability({ exists, isCharacterDevice, canReadWrite });
  const runtimes = {
    runsc: hasExecutable("runsc"),
    firecracker: hasExecutable("firecracker"),
    jailer: hasExecutable("jailer"),
    runc: hasExecutable("runc"),
  };
  const blockers = [];

  if (platform !== "linux") blockers.push("linux_host_required");
  if (cgroupControllers === null) blockers.push("cgroup_v2_not_detected");
  if (runtimes.firecracker && !kvm.accessible) {
    blockers.push("firecracker_kvm_unavailable_to_current_user");
  }
  if (!runtimes.runsc && !(runtimes.firecracker && kvm.accessible)) {
    blockers.push("no_candidate_stronger_than_shared_kernel_runtime_detected");
  }
  blockers.push("independent_runtime_policy_and_security_qualification_required");

  return {
    schemaVersion: "preview-runner-host-preflight.v1",
    classification: "diagnostic_only_not_qualification",
    host: {
      platform,
      architecture,
      kernelRelease,
      effectiveUid: uid,
    },
    kernelFeatures: {
      cgroupV2: cgroupControllers !== null,
      cgroupControllers: cgroupControllers
        ? cgroupControllers.split(/\s+/).filter(Boolean)
        : [],
      landlockListedInLsm:
        lsmList === null
          ? null
          : lsmList.split(",").map((entry) => entry.trim()).includes("landlock"),
      maxUserNamespaces:
        maxUserNamespaces !== null && /^\d+$/.test(maxUserNamespaces)
          ? Number(maxUserNamespaces)
          : null,
      unprivilegedUserNamespaces:
        unprivilegedUserNamespaces !== null &&
        /^[01]$/.test(unprivilegedUserNamespaces)
          ? unprivilegedUserNamespaces === "1"
          : null,
      kvmDevice: kvm,
    },
    runtimes,
    candidateExecutionAllowed: false,
    blockers,
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  process.stdout.write(`${JSON.stringify(buildHostPreflight(), null, 2)}\n`);
}
