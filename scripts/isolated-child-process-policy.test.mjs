import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";
import { buildIsolatedChildEnvironment } from "./isolated-child-process-policy.mjs";

const execFileAsync = promisify(execFile);
const guardPath = fileURLToPath(new URL("./runtime-egress-guard.mjs", import.meta.url));

async function makeFixtureRoot() {
  const root = await mkdtemp(path.join(tmpdir(), "engineeringos-child-policy-"));
  await mkdir(path.join(root, "project"), { recursive: true });
  await mkdir(path.join(root, "remote.git"), { recursive: true });
  await writeFile(
    path.join(root, "project", "package.json"),
    JSON.stringify({
      name: "isolated-lifecycle-fixture",
      private: true,
      scripts: {
        dev: "node --import ../../../../scripts/runtime-egress-guard.mjs ./runtime-server.mjs",
        typecheck: "node --test",
      },
    }),
  );
  return {
    root,
    project: path.join(root, "project"),
    remote: path.join(root, "remote.git"),
  };
}

function guardedEnvironment(fixture, auditPath) {
  return {
    PATH: process.env.PATH ?? "",
    HOME: fixture.root,
    TMPDIR: fixture.root,
    NODE_ENV: "test",
    NODE_OPTIONS: "",
    ENGINEERING_AGENT_LIFECYCLE_PROJECT_ROOT: fixture.project,
    ENGINEERING_AGENT_LIFECYCLE_REMOTE: fixture.remote,
    ENGINEERINGOS_RUNTIME_EGRESS_GUARD_CHILD_MODE: "lifecycle-local",
    ENGINEERINGOS_RUNTIME_EGRESS_GUARD_ALLOWED_ROOTS_JSON: JSON.stringify([
      fixture.project,
      fixture.remote,
    ]),
    ...(auditPath ? { ENGINEERINGOS_RUNTIME_EGRESS_AUDIT_PATH: auditPath } : {}),
  };
}

async function runGuarded(fixture, source, auditPath) {
  const { stdout, stderr } = await execFileAsync(
    process.execPath,
    ["--import", guardPath, "--input-type=module", "-e", source],
    {
      cwd: fixture.root,
      env: guardedEnvironment(fixture, auditPath),
      timeout: 10_000,
      maxBuffer: 1024 * 1024,
    },
  );
  return { stdout, stderr };
}

test("deny unknown executables and arbitrary shell commands before spawning", async () => {
  const fixture = await makeFixtureRoot();
  try {
    const source = `
      import assert from "node:assert/strict";
      import childProcess from "node:child_process";
      assert.throws(
        () => childProcess.spawn("curl", ["https://api.clerk.com"]),
        /not_allowlisted/u,
      );
      assert.throws(
        () => childProcess.spawn("sh", ["-c", "echo unsafe"], { cwd: ${JSON.stringify(fixture.project)} }),
        /shell_command_not_allowlisted/u,
      );
      assert.throws(
        () => childProcess.execFileSync("node", ["-e", "process.exit(0)"]),
        /execFileSync_not_supported/u,
      );
      console.log("blocked-before-spawn");
    `;
    const { stdout } = await runGuarded(fixture, source);
    assert.match(stdout, /blocked-before-spawn/u);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("allow a scoped local Git read and deny external Git protocols before spawning", async () => {
  const fixture = await makeFixtureRoot();
  try {
    await execFileAsync("git", ["init", "-q"], { cwd: fixture.project });
    const source = `
      import assert from "node:assert/strict";
      import childProcess from "node:child_process";
      const output = await new Promise((resolve, reject) => {
        const child = childProcess.spawn(
          "git",
          ["-C", ${JSON.stringify(fixture.project)}, "status", "--short"],
          { cwd: ${JSON.stringify(fixture.root)}, stdio: ["ignore", "pipe", "pipe"] },
        );
        let stdout = "";
        let stderr = "";
        child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
        child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
        child.once("error", reject);
        child.once("close", (code) => code === 0 ? resolve(stdout) : reject(new Error(stderr)));
      });
      assert.equal(output.trim(), "?? package.json");
      assert.throws(
        () => childProcess.spawn(
          "git",
          ["clone", "https://github.com/fixture/repo.git", ${JSON.stringify(path.join(fixture.root, "clone"))}],
          { cwd: ${JSON.stringify(fixture.project)} },
        ),
        /git_network_address_forbidden|git_subcommand_clone_not_allowlisted/u,
      );
      console.log("local-git-only");
    `;
    const auditPath = path.join(fixture.root, "audit.jsonl");
    const { stdout } = await runGuarded(fixture, source, auditPath);
    assert.match(stdout, /local-git-only/u);
    const events = (await readFile(auditPath, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.ok(events.some((event) => event.kind === "child-started" && event.command === "git"));
    assert.ok(events.some((event) => event.kind === "child-exited" && event.command === "git"));
    assert.ok(events.some((event) => event.kind === "blocked-child-process"));
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("allow only the fixed local tar export arguments and reject out-of-root paths", async () => {
  const fixture = await makeFixtureRoot();
  try {
    const source = `
      import assert from "node:assert/strict";
      import childProcess from "node:child_process";
      const output = await new Promise((resolve, reject) => {
        const child = childProcess.spawn(
          "tar",
          ["-czf", "-", "-C", ${JSON.stringify(fixture.project)}, "."],
          { cwd: ${JSON.stringify(fixture.root)}, stdio: ["ignore", "pipe", "pipe"] },
        );
        let bytes = 0;
        child.stdout.on("data", (chunk) => { bytes += chunk.length; });
        child.stderr.resume();
        child.once("error", reject);
        child.once("close", (code) => code === 0 ? resolve(bytes) : reject(new Error("tar failed")));
      });
      assert.ok(output > 0);
      assert.throws(
        () => childProcess.spawn(
          "tar",
          ["-czf", "-", "-C", "/etc", "."],
          { cwd: ${JSON.stringify(fixture.root)} },
        ),
        /outside_owned_roots/u,
      );
      console.log("local-tar-only");
    `;
    const { stdout } = await runGuarded(fixture, source);
    assert.match(stdout, /local-tar-only/u);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("child environment excludes provider and identity secrets and forces offline Git/package settings", () => {
  const safe = buildIsolatedChildEnvironment({
    OPENROUTER_API_KEY: "fake-test-only-value",
    CLERK_SECRET_KEY: "fake-test-only-value",
    SESSION_SECRET: "fake-test-only-value",
    CUSTOM_HOST_SETTING: "not-allowlisted",
    PATH: "/bin:/usr/bin",
  });
  assert.equal(safe.OPENROUTER_API_KEY, undefined);
  assert.equal(safe.CLERK_SECRET_KEY, undefined);
  assert.equal(safe.SESSION_SECRET, undefined);
  assert.equal(safe.CUSTOM_HOST_SETTING, undefined);
  assert.equal(safe.PATH, "/bin:/usr/bin");
  assert.equal(safe.GIT_ALLOW_PROTOCOL, "file");
  assert.equal(safe.GIT_TERMINAL_PROMPT, "0");
  assert.equal(safe.npm_config_offline, "true");
  assert.equal(safe.COREPACK_ENABLE_NETWORK, "0");
  assert.match(safe.NODE_OPTIONS, /runtime-egress-guard\.mjs/u);
});

test("network guard records a refused external request without contacting its destination", async () => {
  const fixture = await makeFixtureRoot();
  const auditPath = path.join(fixture.root, "egress.jsonl");
  try {
    const source = `
      import assert from "node:assert/strict";
      assert.throws(
        () => fetch("https://api.openrouter.ai/models"),
        /egress blocked/u,
      );
      console.log("external-fetch-blocked");
    `;
    const { stdout } = await runGuarded(fixture, source, auditPath);
    assert.match(stdout, /external-fetch-blocked/u);
    const events = (await readFile(auditPath, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.ok(events.some((event) =>
      event.kind === "blocked-egress"
      && event.host === "api.openrouter.ai"
      && event.transport === "fetch",
    ));
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});
