import childProcess from "node:child_process";
import { appendFileSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const POLICY_MODE = "lifecycle-local";
const MAX_CAPTURED_OUTPUT = 32 * 1024 * 1024;
const MAX_COMMAND_TIMEOUT_MS = 120_000;
const MAX_RUNTIME_TIMEOUT_MS = 30 * 60_000;
const SAFE_ENV_KEYS = new Set([
  "CI",
  "COREPACK_ENABLE_NETWORK",
  "ENGINEERING_AGENT_LIFECYCLE_PROJECT_ROOT",
  "ENGINEERING_AGENT_LIFECYCLE_REMOTE",
  "ENGINEERING_AGENT_LIFECYCLE_RUN_ID",
  "ENGINEERINGOS_RUNTIME_EGRESS_AUDIT_PATH",
  "ENGINEERINGOS_RUNTIME_EGRESS_GUARD_ALLOWED_ROOTS_JSON",
  "ENGINEERINGOS_RUNTIME_EGRESS_GUARD_CHILD_MODE",
  "HOME",
  "LANG",
  "LC_ALL",
  "NODE_ENV",
  "NODE_OPTIONS",
  "PATH",
  "PORT",
  "PNPM_HOME",
  "TMP",
  "TMPDIR",
  "TEMP",
  "TZ",
  "BASE_PATH",
]);
const SAFE_GIT_SUBCOMMANDS = new Set([
  "add",
  "cat-file",
  "checkout",
  "commit",
  "commit-tree",
  "diff",
  "diff-index",
  "diff-tree",
  "hash-object",
  "log",
  "ls-tree",
  "rev-parse",
  "show",
  "show-ref",
  "status",
  "symbolic-ref",
  "update-index",
  "update-ref",
  "write-tree",
]);
const UNSAFE_GIT_SUBCOMMANDS = new Set([
  "clone",
  "fetch",
  "ls-remote",
  "pull",
  "push",
  "remote",
  "submodule",
]);
const EXPECTED_TEST_SCRIPTS = Object.freeze({
  dev: "node --import ../../../../scripts/runtime-egress-guard.mjs ./runtime-server.mjs",
  typecheck: "node --test",
});
const EGRESS_GUARD_PATH = fileURLToPath(new URL("./runtime-egress-guard.mjs", import.meta.url));
const auditedChildPids = new Map();

function audit(event) {
  const auditPath = process.env.ENGINEERINGOS_RUNTIME_EGRESS_AUDIT_PATH;
  if (!auditPath) return;
  appendFileSync(
    auditPath,
    `${JSON.stringify({
      at: new Date().toISOString(),
      pid: process.pid,
      ...event,
    })}\n`,
    { encoding: "utf8", mode: 0o600 },
  );
}

function failClosed(reason, command, cwd) {
  audit({
    kind: "blocked-child-process",
    reason,
    command: path.basename(String(command ?? "unknown")),
    cwd: typeof cwd === "string" ? cwd : null,
  });
  throw new Error(`Isolated child-process policy blocked ${path.basename(String(command ?? "unknown"))}: ${reason}.`);
}

function normalizePath(candidate, cwd) {
  if (typeof candidate !== "string" || candidate.length === 0) {
    throw new Error("path_missing");
  }
  return realpathSync(path.resolve(cwd, candidate));
}

function isWithin(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function allowedRoots() {
  let configured;
  try {
    configured = JSON.parse(
      process.env.ENGINEERINGOS_RUNTIME_EGRESS_GUARD_ALLOWED_ROOTS_JSON ?? "[]",
    );
  } catch {
    return [];
  }
  if (!Array.isArray(configured) || configured.some((value) => typeof value !== "string")) {
    return [];
  }
  const roots = [];
  for (const root of configured) {
    try {
      const resolved = realpathSync(root);
      if (!roots.includes(resolved)) roots.push(resolved);
    } catch {
      // A missing or stale owner root is never permission to run a child.
    }
  }
  return roots;
}

function assertOwnedPath(candidate, cwd, label) {
  let resolved;
  try {
    resolved = normalizePath(candidate, cwd);
  } catch {
    throw new Error(`${label}_path_unavailable`);
  }
  if (!allowedRoots().some((root) => isWithin(root, resolved))) {
    throw new Error(`${label}_outside_owned_roots`);
  }
  return resolved;
}

function childCwd(options) {
  const cwd = options?.cwd ?? process.cwd();
  return assertOwnedPath(cwd, process.cwd(), "cwd");
}

export function buildIsolatedChildEnvironment(provided = {}) {
  const env = {};
  for (const key of SAFE_ENV_KEYS) {
    const value =
      typeof provided[key] === "string"
        ? provided[key]
        : process.env[key];
    if (typeof value === "string") env[key] = value;
  }
  env.NODE_OPTIONS = `--import=${EGRESS_GUARD_PATH}`;
  env.COREPACK_ENABLE_NETWORK = "0";
  env.npm_config_offline = "true";
  env.GIT_ALLOW_PROTOCOL = "file";
  env.GIT_CONFIG_NOSYSTEM = "1";
  env.GIT_CONFIG_GLOBAL = "/dev/null";
  env.GIT_TERMINAL_PROMPT = "0";
  env.GIT_ASKPASS = "/bin/false";
  env.GIT_CONFIG_COUNT = "1";
  env.GIT_CONFIG_KEY_0 = "core.hooksPath";
  env.GIT_CONFIG_VALUE_0 = "/dev/null";
  return env;
}

function commandName(command) {
  return path.basename(String(command));
}

function assertPackageScript(root, scriptName) {
  let packageManifest;
  try {
    packageManifest = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
  } catch {
    throw new Error("package_manifest_unavailable");
  }
  if (packageManifest?.scripts?.[scriptName] !== EXPECTED_TEST_SCRIPTS[scriptName]) {
    throw new Error(`package_script_${scriptName}_not_allowlisted`);
  }
}

function gitSubcommand(args) {
  const optionsWithValue = new Set([
    "-C",
    "-c",
    "--git-dir",
    "--work-tree",
    "--namespace",
    "--config-env",
  ]);
  for (let index = 0; index < args.length; index += 1) {
    const value = String(args[index]);
    if (optionsWithValue.has(value)) {
      index += 1;
      continue;
    }
    if (value.startsWith("--git-dir=")) continue;
    if (value.startsWith("--work-tree=")) continue;
    if (value.startsWith("-c") && value.length > 2) continue;
    if (value.startsWith("-")) continue;
    return value;
  }
  return null;
}

function assertLocalGitInvocation(args, cwd) {
  if (
    args.some((argument) =>
      /(?:https?:\/\/|ssh:\/\/|git:\/\/|ext::|(?:^|\/)[^/]+@[^/:]+:)/iu
        .test(String(argument)),
    )
  ) {
    throw new Error("git_network_address_forbidden");
  }
  const subcommand = gitSubcommand(args);
  if (!subcommand || UNSAFE_GIT_SUBCOMMANDS.has(subcommand) || !SAFE_GIT_SUBCOMMANDS.has(subcommand)) {
    throw new Error(`git_subcommand_${subcommand ?? "missing"}_not_allowlisted`);
  }

  const pathArgs = [];
  for (let index = 0; index < args.length; index += 1) {
    const argument = String(args[index]);
    if (["-C", "--git-dir", "--work-tree"].includes(argument)) {
      const value = args[index + 1];
      if (typeof value !== "string") throw new Error("git_path_argument_missing");
      pathArgs.push(value);
      index += 1;
    } else if (argument.startsWith("--git-dir=")) {
      pathArgs.push(argument.slice("--git-dir=".length));
    } else if (argument.startsWith("--work-tree=")) {
      pathArgs.push(argument.slice("--work-tree=".length));
    }
  }
  if (pathArgs.length === 0) return assertOwnedPath(cwd, process.cwd(), "git_cwd");
  const resolvedPaths = pathArgs.map((value) =>
    assertOwnedPath(value, cwd, "git_root"),
  );
  return resolvedPaths.at(-1);
}

function authorize(command, args, options = {}) {
  const mode = process.env.ENGINEERINGOS_RUNTIME_EGRESS_GUARD_CHILD_MODE;
  const executable = commandName(command);
  const requestedCwd = options.cwd ?? process.cwd();
  const argv = args.map((argument) => String(argument));

  if (mode !== POLICY_MODE) {
    throw new Error("child_process_disabled");
  }

  if (executable === "git") {
    const cwd = assertLocalGitInvocation(argv, requestedCwd);
    return {
      classification: "local-git",
      cwd,
      env: buildIsolatedChildEnvironment(options.env),
      timeout: Math.min(
        Number.isFinite(options.timeout) && options.timeout > 0
          ? options.timeout
          : MAX_COMMAND_TIMEOUT_MS,
        MAX_COMMAND_TIMEOUT_MS,
      ),
      maxBuffer: Math.min(
        Number.isFinite(options.maxBuffer) && options.maxBuffer > 0
          ? options.maxBuffer
          : 8 * 1024 * 1024,
        MAX_CAPTURED_OUTPUT,
      ),
    };
  }

  if (executable === "tar") {
    if (
      argv.length !== 5
      || argv[0] !== "-czf"
      || argv[1] !== "-"
      || argv[2] !== "-C"
      || argv[4] !== "."
    ) {
      throw new Error("tar_arguments_not_allowlisted");
    }
    const root = assertOwnedPath(argv[3], requestedCwd, "tar_root");
    return {
      classification: "local-tar",
      cwd: root,
      env: buildIsolatedChildEnvironment(options.env),
      timeout: Math.min(
        Number.isFinite(options.timeout) && options.timeout > 0
          ? options.timeout
          : MAX_COMMAND_TIMEOUT_MS,
        MAX_COMMAND_TIMEOUT_MS,
      ),
      maxBuffer: MAX_CAPTURED_OUTPUT,
      root,
    };
  }

  if (executable === "pnpm") {
    const scriptName =
      argv.length === 2 && argv[0] === "run" ? argv[1] : undefined;
    if (scriptName !== "dev" && scriptName !== "typecheck") {
      throw new Error("pnpm_command_not_allowlisted");
    }
    const cwd = childCwd(options);
    assertPackageScript(cwd, scriptName);
    return {
      classification: `project-script-${scriptName}`,
      cwd,
      env: buildIsolatedChildEnvironment(options.env),
      timeout: scriptName === "dev" ? MAX_RUNTIME_TIMEOUT_MS : MAX_COMMAND_TIMEOUT_MS,
      maxBuffer: MAX_CAPTURED_OUTPUT,
    };
  }

  if (executable === "sh" || executable === "bash") {
    const scriptName =
      argv.length === 2 && argv[0] === "-c"
        ? Object.entries(EXPECTED_TEST_SCRIPTS)
            .find(([, expected]) => expected === argv[1])?.[0]
        : undefined;
    if (!scriptName) throw new Error("shell_command_not_allowlisted");
    const cwd = childCwd(options);
    assertPackageScript(cwd, scriptName);
    return {
      classification: `package-script-shell-${scriptName}`,
      cwd,
      env: buildIsolatedChildEnvironment(options.env),
      timeout: scriptName === "dev" ? MAX_RUNTIME_TIMEOUT_MS : MAX_COMMAND_TIMEOUT_MS,
      maxBuffer: MAX_CAPTURED_OUTPUT,
    };
  }

  throw new Error(`executable_${executable}_not_allowlisted`);
}

function attachChildTracking(child, command, authorized) {
  if (!child || !Number.isInteger(child.pid)) {
    child?.kill?.("SIGKILL");
    throw new Error("Isolated child process did not receive a trackable PID.");
  }
  const detached = process.platform !== "win32";
  const entry = {
    pid: child.pid,
    command: commandName(command),
    classification: authorized.classification,
    cwd: authorized.cwd,
    detached,
    child,
  };
  auditedChildPids.set(child.pid, entry);
  audit({
    kind: "child-started",
    pid: entry.pid,
    command: entry.command,
    classification: entry.classification,
    cwd: entry.cwd,
    detached: entry.detached,
  });

  let timeoutTimer;
  let forceKillTimer;
  const clearTimers = () => {
    clearTimeout(timeoutTimer);
    clearTimeout(forceKillTimer);
  };
  const scheduleForceKill = () => {
    if (forceKillTimer) return;
    forceKillTimer = setTimeout(() => killGroup("SIGKILL"), 1_000);
    forceKillTimer.unref();
  };
  const killGroup = (signal) => {
    if (detached) {
      try {
        process.kill(-child.pid, signal);
        return;
      } catch (error) {
        if (error?.code === "ESRCH") return;
      }
    }
    child.kill(signal);
  };
  if (Number.isFinite(authorized.timeout) && authorized.timeout > 0) {
    timeoutTimer = setTimeout(() => {
      audit({
        kind: "child-timeout",
        pid: child.pid,
        command: entry.command,
        timeoutMs: authorized.timeout,
      });
      killGroup("SIGTERM");
      scheduleForceKill();
    }, authorized.timeout);
    timeoutTimer.unref();
  }
  let outputBytes = 0;
  const boundOutput = (stream) => {
    if (!stream || typeof stream.on !== "function") return;
    stream.on("data", (chunk) => {
      outputBytes += Buffer.byteLength(chunk);
      if (outputBytes > MAX_CAPTURED_OUTPUT) {
        audit({
          kind: "child-output-limit",
          pid: child.pid,
          command: entry.command,
          limitBytes: MAX_CAPTURED_OUTPUT,
        });
        killGroup("SIGTERM");
        scheduleForceKill();
      }
    });
  };
  boundOutput(child.stdout);
  boundOutput(child.stderr);
  child.once("close", (code, signal) => {
    clearTimers();
    auditedChildPids.delete(child.pid);
    audit({
      kind: "child-exited",
      pid: child.pid,
      command: entry.command,
      code,
      signal,
    });
  });
  child.once("error", () => {
    clearTimers();
    auditedChildPids.delete(child.pid);
    audit({ kind: "child-error", pid: child.pid, command: entry.command });
  });
}

function spawnAuthorized(command, args, options, originalSpawn) {
  const normalized = normalizeSpawnArgs(args, options);
  let authorized;
  try {
    if (normalized.options.shell) throw new Error("shell_option_forbidden");
    authorized = authorize(command, normalized.argv, normalized.options);
  } catch (error) {
    return failClosed(
      error instanceof Error ? error.message : "authorization_failed",
      command,
      normalized.options.cwd,
    );
  }
  const {
    classification,
    maxBuffer: _maxBuffer,
    root: _root,
    timeout: _timeout,
    ...nativeOptions
  } = authorized;
  const child = originalSpawn.call(childProcess, command, normalized.argv, {
    ...normalized.options,
    ...nativeOptions,
    detached: process.platform !== "win32",
    shell: false,
  });
  try {
    attachChildTracking(child, command, authorized);
  } catch (error) {
    child.kill("SIGKILL");
    throw error;
  }
  return child;
}

function normalizeSpawnArgs(args, options) {
  return Array.isArray(args)
    ? { argv: args, options: options && typeof options === "object" ? options : {} }
    : { argv: [], options: args && typeof args === "object" ? args : {} };
}

export function installIsolatedChildProcessPolicy(target = childProcess) {
  if (globalThis[Symbol.for("engineeringos.isolated-child-process-policy")]) return;
  const originals = {
    spawn: target.spawn,
    exec: target.exec,
    execSync: target.execSync,
    execFile: target.execFile,
    execFileSync: target.execFileSync,
    spawnSync: target.spawnSync,
    fork: target.fork,
  };

  target.spawn = function isolatedGuardedSpawn(command, args, options) {
    return spawnAuthorized(command, args, options, originals.spawn);
  };

  const originalExecFileCustom = originals.execFile[promisify.custom];
  const guardedExecFile = function isolatedGuardedExecFile(
    command,
    args,
    options,
    callback,
  ) {
    const argv = Array.isArray(args) ? args : [];
    const normalizedOptions = Array.isArray(args)
      ? options && typeof options === "object" ? options : {}
      : args && typeof args === "object" ? args : {};
    const done =
      typeof options === "function"
        ? options
        : callback;
    let authorized;
    try {
      if (normalizedOptions.shell) throw new Error("shell_option_forbidden");
      authorized = authorize(command, argv, normalizedOptions);
    } catch (error) {
      return failClosed(
        error instanceof Error ? error.message : "authorization_failed",
        command,
        normalizedOptions.cwd,
      );
    }
    const {
      classification,
      root: _root,
      timeout: _timeout,
      ...nativeOptions
    } = authorized;
    const child = originals.execFile.call(target, command, argv, {
      ...normalizedOptions,
      ...nativeOptions,
      detached: process.platform !== "win32",
      shell: false,
    }, done);
    try {
      attachChildTracking(child, command, authorized);
    } catch (error) {
      if (Number.isInteger(child?.pid)) {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {
          child.kill?.("SIGKILL");
        }
      }
      throw error;
    }
    return child;
  };
  if (originalExecFileCustom) {
    guardedExecFile[promisify.custom] = function isolatedGuardedExecFilePromise(
      command,
      args,
      options = {},
    ) {
      const argv = Array.isArray(args) ? args : [];
      let authorized;
      try {
        if (options.shell) throw new Error("shell_option_forbidden");
        authorized = authorize(command, argv, options);
      } catch (error) {
        return Promise.reject(error);
      }
      const {
        classification,
        root: _root,
        timeout: _timeout,
        ...nativeOptions
      } = authorized;
      const result = originalExecFileCustom.call(
        target,
        command,
        argv,
        {
          ...options,
          ...nativeOptions,
          detached: process.platform !== "win32",
          shell: false,
        },
      );
      if (result?.child) {
        try {
          attachChildTracking(result.child, command, authorized);
        } catch (error) {
          if (Number.isInteger(result.child.pid)) {
            try {
              process.kill(-result.child.pid, "SIGKILL");
            } catch {
              result.child.kill?.("SIGKILL");
            }
          }
          throw error;
        }
      }
      return result;
    };
  }
  target.execFile = guardedExecFile;

  process.once("exit", () => {
    for (const entry of auditedChildPids.values()) {
      if (entry.detached) {
        try {
          process.kill(-entry.pid, "SIGKILL");
          continue;
        } catch {
          // Fall through to the direct child handle if its group disappeared.
        }
      }
      entry.child.kill("SIGKILL");
    }
  });

  for (const name of ["exec", "execSync", "execFileSync", "spawnSync", "fork"]) {
    target[name] = function isolatedSynchronousOrShellChildBlocked(command, _args, options) {
      return failClosed(
        `${name}_not_supported_by_the_lifecycle_guard`,
        command,
        options?.cwd,
      );
    };
  }

  Object.defineProperty(globalThis, Symbol.for("engineeringos.isolated-child-process-policy"), {
    value: Object.freeze({ installed: true, activePids: auditedChildPids }),
    configurable: false,
    enumerable: false,
    writable: false,
  });
}

export function recordIsolatedGuardEvent(event) {
  audit(event);
}
