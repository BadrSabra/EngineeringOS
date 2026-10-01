import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  executeSingleTool,
  executeToolLoop,
  toolCacheKey,
  type ToolLoopOpts,
  type MutationToolInvocation,
  type ReadOnlyToolInvocation,
  type SingleToolOpts,
  type ToolInvocationLifecycleEvent,
} from "../tool-execution-engine.js";
import type { ProviderStrategy } from "../provider-strategy.js";
import type { RawGroqResponse } from "../groq-client.js";
import {
  authorizeToolInvocation,
  getFullAuthorizedToolManifest,
} from "../tool-policy.js";
import { ANALYSIS_TOOL_DEFINITIONS, type AnalysisCorrelation, type AnalysisToolRunner } from "../tools/analysis-tools.js";
import { BINARY_TOOL_DEFINITIONS } from "../tools/binary-tools.js";
import { CODE_NAVIGATION_TOOL_DEFINITIONS } from "../tools/code-navigation.js";
import {
  type BrowserValidationRunner,
  type CommandProfile,
  type CommandRunner,
  EXECUTION_TOOL_DEFINITIONS,
  runRegisteredCommand,
  type ValidationRunner,
} from "../tools/execution-tools.js";
import { FILE_TOOL_DEFINITIONS } from "../tools/file-tools.js";
import { GIT_TOOL_DEFINITIONS } from "../tools/git-tools.js";
import { PACKAGE_TOOL_DEFINITIONS } from "../tools/package-tools.js";

type SchemaProperty = {
  type?: string;
  enum?: unknown[];
  default?: unknown;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
};

type ToolDefinitionContract = {
  function: {
    name: string;
    parameters: {
      type?: string;
      required?: string[];
      additionalProperties?: boolean;
      properties?: Record<string, SchemaProperty>;
    };
  };
};

const TOOL_DEFINITIONS = [
  ...FILE_TOOL_DEFINITIONS,
  ...GIT_TOOL_DEFINITIONS,
  ...CODE_NAVIGATION_TOOL_DEFINITIONS,
  ...PACKAGE_TOOL_DEFINITIONS,
  ...BINARY_TOOL_DEFINITIONS,
  ...EXECUTION_TOOL_DEFINITIONS,
  ...ANALYSIS_TOOL_DEFINITIONS,
] as unknown as ToolDefinitionContract[];

const EXPECTED_TOOL_NAMES = [
  "ast_navigation",
  "discover_project_apis",
  "git_diff",
  "git_log",
  "git_status",
  "inspect_binary",
  "inspect_dependencies",
  "list_directory",
  "project.list_tree",
  "query_knowledge_graph",
  "read_file",
  "read_file_range",
  "refresh_project_scan",
  "replace_text",
  "run_browser_validation",
  "run_command",
  "run_validation",
  "search_code",
  "symbol_search",
  "write_file",
];

const SAFE_ARGS: Record<string, Record<string, unknown>> = {
  read_file: { path: "src/index.ts" },
  read_file_range: { path: "src/index.ts", startLine: 1, endLine: 3 },
  "project.list_tree": {},
  list_directory: { path: "src" },
  search_code: { pattern: "INVARIANT_FIXTURE", path: "src" },
  replace_text: {
    path: "src/index.ts",
    old_text: "INVARIANT_FIXTURE",
    new_text: "PROPOSED_FIXTURE",
    reason: "acceptance fixture",
  },
  write_file: {
    path: "pending-proposal.txt",
    content: "proposal only",
    reason: "acceptance fixture",
  },
  git_status: {},
  git_diff: { path: "src/index.ts" },
  git_log: {},
  symbol_search: { symbol: "invariantFixture", path: "src/index.ts" },
  ast_navigation: {
    operation: "definition",
    symbol: "invariantFixture",
    path: "src/index.ts",
  },
  inspect_dependencies: {},
  inspect_binary: { path: "fixtures/tiny.png" },
  run_validation: { profile: "fixture-validation" },
  run_browser_validation: { profile: "fixture-browser" },
  run_command: { profile: "fixture-command" },
  refresh_project_scan: {},
  query_knowledge_graph: { operation: "search", query: "fixture" },
  discover_project_apis: {},
};

const TOOL_NAMES = TOOL_DEFINITIONS.map((tool) => tool.function.name);
const TOOL_NAME_SET = new Set(TOOL_NAMES);
const TOOL_CASES = EXPECTED_TOOL_NAMES.map((name) => {
  const args = SAFE_ARGS[name];
  if (!args) throw new Error(`Missing T8 input fixture for ${name}`);
  return { name, args };
});

const READ_RECEIPT_TOOLS = new Set([
  "read_file",
  "read_file_range",
  "project.list_tree",
  "list_directory",
  "search_code",
  "git_status",
  "git_diff",
  "git_log",
  "symbol_search",
  "ast_navigation",
  "inspect_dependencies",
  "inspect_binary",
]);
const WRITE_TOOLS = new Set(["write_file", "replace_text"]);
const EXECUTION_TOOLS = new Set([
  "run_validation",
  "run_browser_validation",
  "run_command",
]);
const PATH_TOOLS = new Set([
  "read_file",
  "read_file_range",
  "list_directory",
  "search_code",
  "replace_text",
  "write_file",
  "git_diff",
  "symbol_search",
  "ast_navigation",
  "inspect_binary",
]);
const APPROVED_FILE_PATHS = ["src/index.ts", "pending-proposal.txt"];
const APPROVED_PROFILES = [
  "fixture-validation",
  "fixture-browser",
  "fixture-command",
];
const TOOL_MANIFEST_HASH = "a".repeat(64);
const TEST_ONLY_SECRET = "T8_FIXTURE_SECRET_MUST_NOT_ESCAPE";
const ANALYSIS_CORRELATION: AnalysisCorrelation = {
  operationId: "t8-operation",
  projectId: "t8-project",
  projectRevision: "t8-revision",
  rootAvailable: true,
  evidenceProvenance: "t8-fixture",
};
const COMMAND_PROFILE: CommandProfile = {
  name: "fixture-command",
  command: "node",
  args: [],
  timeoutMs: 1_000,
  maxOutputBytes: 1_024,
};

let fixtureRoot = "";
let outsideRoot = "";
let outsideSecretPath = "";

const analysisToolRunner: AnalysisToolRunner = async (
  _name,
  _args,
  _signal,
  suppliedCorrelation,
) => {
  if (!suppliedCorrelation) throw new Error("T8 analysis correlation missing");
  return {
    status: "complete",
    output: "{}",
    source: "t8-fixture",
    correlation: suppliedCorrelation,
  };
};

const validationRunner: ValidationRunner = async (profile) => ({
  status: "passed",
  profile,
});

const browserValidationRunner: BrowserValidationRunner = async ({ profile }) => ({
  profile,
  status: "passed",
  scenario: "t8 fixture",
  exitCode: 0,
  command: "fixture",
  stdout: "",
  stderr: "",
  failedTests: [],
  changedFiles: [],
  evidence: {
    evidenceId: `t8-evidence:${profile}`,
    observedAt: "2026-01-01T00:00:00.000Z",
    artifactRef: `t8-fixture:${profile}`,
  },
});

const commandRunner: CommandRunner = async () => ({
  status: "passed",
  exitCode: 0,
  signal: null,
  stdout: "",
  stderr: "",
  combinedOutput: "",
  truncated: false,
  durationMs: 0,
});

function makeCall(
  name: string,
  args: Record<string, unknown>,
  overrides: Partial<SingleToolOpts> = {},
) {
  const pendingChanges: Parameters<typeof executeSingleTool>[0]["pendingChanges"] = [];
  const readEvents: ReadOnlyToolInvocation[] = [];
  const mutationEvents: MutationToolInvocation[] = [];
  const lifecycleEvents: ToolInvocationLifecycleEvent[] = [];
  const options: SingleToolOpts = {
    name,
    args,
    rootPath: fixtureRoot,
    pendingChanges,
    allowedToolNames: TOOL_NAME_SET,
    allowExecutionTools: true,
    approvalState: "APPROVED",
    approvedFilePaths: APPROVED_FILE_PATHS,
    approvedValidationProfiles: APPROVED_PROFILES,
    analysisCorrelation: ANALYSIS_CORRELATION,
    analysisToolRunner,
    validationRunner,
    browserValidationRunner,
    commandProfiles: [COMMAND_PROFILE],
    commandRunner,
    toolCallId: `t8-${name}`,
    toolManifestHash: TOOL_MANIFEST_HASH,
    onReadOnlyInvocation: async (event) => {
      readEvents.push(event);
    },
    onMutationInvocation: async (event) => {
      mutationEvents.push(event);
    },
    onToolInvocation: async (event) => {
      lifecycleEvents.push(event);
    },
    ...overrides,
  };
  return { options, pendingChanges, readEvents, mutationEvents, lifecycleEvents };
}

function visibleOutput(result: Awaited<ReturnType<typeof executeSingleTool>>): string {
  if (result.kind === "ok") return result.output;
  if (result.kind === "failed") return result.safeMessage;
  return result.errorMessage;
}

function definitionFor(name: string): ToolDefinitionContract {
  const definition = TOOL_DEFINITIONS.find((tool) => tool.function.name === name);
  if (!definition) throw new Error(`Missing T8 definition for ${name}`);
  return definition;
}

function makeLoopToolCall(
  id: string,
  name: string,
  args: Record<string, unknown>,
): NonNullable<RawGroqResponse["toolCalls"]>[number] {
  return {
    id,
    type: "function",
    function: { name, arguments: JSON.stringify(args) },
  };
}

function makeLoopResponse(
  content: string,
  toolCalls: RawGroqResponse["toolCalls"] = null,
): RawGroqResponse {
  return {
    content,
    toolCalls,
    model: "t8-fixture",
    usage: { promptTokens: 0, completionTokens: 0 },
  };
}

function makeLoopStrategy(toolCalls: RawGroqResponse["toolCalls"]): ProviderStrategy {
  const responses = [
    makeLoopResponse("", toolCalls),
    makeLoopResponse("T8 fixture complete"),
  ];
  let responseIndex = 0;
  return {
    providerId: "t8-fixture",
    supportsNativeStream: false,
    call: vi.fn(async () => {
      const response = responses[responseIndex];
      if (!response) throw new Error(`Unexpected T8 provider call ${responseIndex}`);
      responseIndex += 1;
      return response;
    }),
    stream: async function* () {
      yield "";
    },
  };
}

async function runT8ToolLoop(
  name: string,
  args: Record<string, unknown>,
  overrides: Partial<ToolLoopOpts> = {},
  toolCalls: RawGroqResponse["toolCalls"] = [makeLoopToolCall(`t8-${name}`, name, args)],
) {
  const tool = definitionFor(name) as unknown as NonNullable<ToolLoopOpts["tools"]>[number];
  const messages: ToolLoopOpts["messages"] = [
    { role: "user", content: `Run the T8 fixture for ${name}.` },
  ];
  const pendingChanges: ToolLoopOpts["pendingChanges"] = [];
  const options: ToolLoopOpts = {
    messages,
    strategy: makeLoopStrategy(toolCalls),
    model: "t8-fixture",
    powerModel: "t8-fixture",
    provider: "t8-fixture",
    tools: [tool],
    toolManifest: TOOL_DEFINITIONS as unknown as ToolLoopOpts["toolManifest"],
    rootPath: fixtureRoot,
    pendingChanges,
    allowedToolNames: [name],
    allowExecutionTools: true,
    approvalState: "APPROVED",
    approvedFilePaths: APPROVED_FILE_PATHS,
    approvedValidationProfiles: APPROVED_PROFILES,
    analysisCorrelation: ANALYSIS_CORRELATION,
    analysisToolRunner,
    validationRunner,
    browserValidationRunner,
    commandProfiles: [COMMAND_PROFILE],
    commandRunner,
    maxIterations: 4,
    ...overrides,
  };
  const result = await executeToolLoop(options);
  return { result, messages, pendingChanges, options };
}

function wrongValueFor(type: string | undefined): unknown {
  if (type === "string") return 42;
  if (type === "integer" || type === "number") return "not-a-number";
  if (type === "boolean") return "not-a-boolean";
  return null;
}

async function expectInputRejected(name: string, args: unknown) {
  const call = makeCall(name, args as Record<string, unknown>);
  const result = await executeSingleTool(call.options);
  expect(result.kind).toBe("failed");
  if (result.kind === "failed") {
    expect(result.diagnosticCode).toBe("TOOL_EXECUTION_FAILED");
  }
  expect(call.pendingChanges).toHaveLength(0);
  expect(call.readEvents).toHaveLength(0);
  expect(call.mutationEvents).toHaveLength(0);
}

beforeAll(async () => {
  fixtureRoot = await mkdtemp(path.join(os.tmpdir(), "reliable-tool-agent-t8-"));
  outsideRoot = await mkdtemp(path.join(os.tmpdir(), "reliable-tool-agent-outside-"));
  outsideSecretPath = path.join(outsideRoot, "outside-secret.txt");

  await mkdir(path.join(fixtureRoot, "src"), { recursive: true });
  await mkdir(path.join(fixtureRoot, "fixtures"), { recursive: true });
  await mkdir(path.join(fixtureRoot, "bulk"), { recursive: true });
  await writeFile(
    path.join(fixtureRoot, "package.json"),
    JSON.stringify({ name: "reliable-tool-agent-t8-fixture", version: "1.0.0" }, null, 2),
  );
  await writeFile(
    path.join(fixtureRoot, "src", "index.ts"),
    'export const invariantFixture = "INVARIANT_FIXTURE";\n',
  );
  await writeFile(path.join(fixtureRoot, ".env"), `TOKEN=${TEST_ONLY_SECRET}\n`);
  await writeFile(outsideSecretPath, TEST_ONLY_SECRET);
  await writeFile(
    path.join(fixtureRoot, "fixtures", "tiny.png"),
    Buffer.from("89504e470d0a1a0a0000000d4948445200000002000000030806000000", "hex"),
  );
  await symlink(outsideSecretPath, path.join(fixtureRoot, "escape.txt"));

  execFileSync("git", ["init"], { cwd: fixtureRoot, stdio: "ignore" });
  execFileSync("git", ["config", "user.email", "t8-fixture@example.invalid"], {
    cwd: fixtureRoot,
    stdio: "ignore",
  });
  execFileSync("git", ["config", "user.name", "T8 Fixture"], {
    cwd: fixtureRoot,
    stdio: "ignore",
  });
  execFileSync("git", ["add", "package.json", "src/index.ts", "fixtures/tiny.png"], {
    cwd: fixtureRoot,
    stdio: "ignore",
  });
  execFileSync("git", ["commit", "-m", "T8 fixture baseline"], {
    cwd: fixtureRoot,
    stdio: "ignore",
  });

  const nestedRepo = path.join(fixtureRoot, "nested-repo");
  await mkdir(nestedRepo, { recursive: true });
  execFileSync("git", ["init"], { cwd: nestedRepo, stdio: "ignore" });
  execFileSync("git", ["config", "user.email", "nested@example.invalid"], {
    cwd: nestedRepo,
    stdio: "ignore",
  });
  execFileSync("git", ["config", "user.name", "Nested Fixture"], {
    cwd: nestedRepo,
    stdio: "ignore",
  });
  await writeFile(path.join(nestedRepo, "nested.ts"), "export const nestedFixture = true;\n");
  execFileSync("git", ["add", "nested.ts"], { cwd: nestedRepo, stdio: "ignore" });
  execFileSync("git", ["commit", "-m", "T8_NESTED_REPOSITORY_SENTINEL"], {
    cwd: nestedRepo,
    stdio: "ignore",
  });

  for (let index = 0; index < 80; index += 1) {
    await writeFile(
      path.join(fixtureRoot, "bulk", `match-${index.toString().padStart(3, "0")}.txt`),
      `${"MATCH_TOKEN ".repeat(300)}\n`,
    );
  }
  await writeFile(path.join(fixtureRoot, "huge.txt"), "L".repeat(1_000_000));
});

afterAll(async () => {
  if (fixtureRoot) await rm(fixtureRoot, { recursive: true, force: true });
  if (outsideRoot) await rm(outsideRoot, { recursive: true, force: true });
});

describe("Reliable Tool Agent T8 adversarial acceptance matrix", () => {
  it("keeps all 20 executable tools aligned across definitions, schemas, and the server manifest", async () => {
    const sortedNames = [...TOOL_NAMES].sort();
    expect(sortedNames).toEqual(EXPECTED_TOOL_NAMES);
    expect(new Set(TOOL_NAMES).size).toBe(TOOL_NAMES.length);
    expect(Object.keys(SAFE_ARGS).sort()).toEqual(EXPECTED_TOOL_NAMES);

    for (const tool of TOOL_DEFINITIONS) {
      const { parameters } = tool.function;
      expect(parameters.type, tool.function.name).toBe("object");
      expect(parameters.additionalProperties, tool.function.name).toBe(false);
      expect(parameters.properties, tool.function.name).toBeDefined();
      for (const required of parameters.required ?? []) {
        expect(parameters.properties, tool.function.name).toHaveProperty(required);
      }
    }

    const manifestNames = getFullAuthorizedToolManifest()
      .map((entry) => entry.name)
      .sort();
    expect(manifestNames).toEqual(EXPECTED_TOOL_NAMES);

    for (const name of EXPECTED_TOOL_NAMES) {
      const call = makeCall(name, { __unknown_t8_field__: true });
      const result = await executeSingleTool(call.options);
      expect(result.kind, name).toBe("failed");
      expect(call.pendingChanges, name).toHaveLength(0);
      expect(call.readEvents, name).toHaveLength(0);
      expect(call.mutationEvents, name).toHaveLength(0);
    }
  });

  it.each(TOOL_CASES)(
    "$name dispatches through its registered executor with isolated fixture inputs",
    async ({ name, args }) => {
      const before = name === "replace_text"
        ? await readFile(path.join(fixtureRoot, "src", "index.ts"), "utf8")
        : undefined;
      const call = makeCall(name, args);
      const result = await executeSingleTool(call.options);

      expect(result.kind, visibleOutput(result)).toBe("ok");
      if (READ_RECEIPT_TOOLS.has(name)) {
        expect(call.readEvents.map((event) => event.phase), name).toEqual([
          "requested",
          "recorded",
        ]);
      }
      if (WRITE_TOOLS.has(name)) {
        expect(call.mutationEvents.map((event) => event.phase), name).toEqual([
          "requested",
          "committed",
        ]);
        expect(call.pendingChanges.length, name).toBeGreaterThan(0);
      }
      if (before !== undefined) {
        expect(await readFile(path.join(fixtureRoot, "src", "index.ts"), "utf8")).toBe(before);
      }
      if (name === "write_file") {
        expect(call.pendingChanges).toHaveLength(1);
        await expect(readFile(path.join(fixtureRoot, "pending-proposal.txt"), "utf8"))
          .rejects.toMatchObject({ code: "ENOENT" });
      }
    },
  );

  it.each(TOOL_CASES)(
    "$name fails closed when it is absent from the effective tool manifest",
    async ({ name, args }) => {
      const call = makeCall(name, args, { allowedToolNames: new Set() });
      const result = await executeSingleTool(call.options);

      expect(result.kind, name).toBe("failed");
      if (result.kind === "failed") {
        expect(result.failureKind, name).toBe("unavailable");
        expect(result.diagnosticCode, name).toBe("TOOL_UNAVAILABLE");
        expect(result.safeMessage, name).toContain("authorization gate");
      }
      expect(call.pendingChanges, name).toHaveLength(0);
      expect(call.readEvents, name).toHaveLength(0);
      expect(call.mutationEvents, name).toHaveLength(0);

      const authorization = authorizeToolInvocation({
        toolName: name,
        args,
        allowedTools: new Set(),
        approvalState: "APPROVED",
        approvedFilePaths: APPROVED_FILE_PATHS,
        approvedValidationProfiles: APPROVED_PROFILES,
      });
      expect(authorization).toEqual({
        allowed: false,
        reason: "tool_not_in_manifest",
      });
    },
  );

  it.each(TOOL_CASES)(
    "$name rejects an extra argument before invoking its executor",
    async ({ name, args }) => {
      await expectInputRejected(name, { ...args, __unregistered_t8_field__: true });
    },
  );

  it.each(TOOL_CASES)(
    "$name rejects a non-object argument payload",
    async ({ name }) => {
      await expectInputRejected(name, null);
    },
  );

  it.each(TOOL_CASES.filter(({ name }) => {
    const definition = definitionFor(name);
    return (definition.function.parameters.required ?? []).some(
      (key) => !Object.prototype.hasOwnProperty.call(
        definition.function.parameters.properties?.[key] ?? {},
        "default",
      ),
    );
  }))(
    "$name rejects each missing required argument",
    async ({ name, args }) => {
      const definition = definitionFor(name);
      const required = definition.function.parameters.required ?? [];
      for (const key of required) {
        if (Object.prototype.hasOwnProperty.call(
          definition.function.parameters.properties?.[key] ?? {},
          "default",
        )) continue;
        const missing = { ...args };
        delete missing[key];
        await expectInputRejected(name, missing);
      }
    },
  );

  it.each(TOOL_CASES)(
    "$name rejects a value with the wrong primitive type",
    async ({ name, args }) => {
      const properties = definitionFor(name).function.parameters.properties ?? {};
      const propertyName = Object.keys(properties)[0];
      if (!propertyName) {
        await expectInputRejected(name, { invalid: 1 });
        return;
      }
      await expectInputRejected(name, {
        ...args,
        [propertyName]: wrongValueFor(properties[propertyName]?.type),
      });
    },
  );

  it.each(TOOL_CASES.filter(({ name }) =>
    Object.values(definitionFor(name).function.parameters.properties ?? {})
      .some((property) => property.type === "string"),
  ))(
    "$name rejects oversized string arguments before dispatch",
    async ({ name, args }) => {
      const properties = definitionFor(name).function.parameters.properties ?? {};
      const propertyName = Object.entries(properties)
        .find(([, property]) => property.type === "string")?.[0];
      expect(propertyName, name).toBeDefined();
      await expectInputRejected(name, {
        ...args,
        [propertyName as string]: "X".repeat(128_001),
      });
    },
  );

  it.each(["write_file", "replace_text"])(
    "%s requires explicit approval and an exact approved path",
    (name) => {
      const args = SAFE_ARGS[name]!;
      const missingApproval = authorizeToolInvocation({
        toolName: name,
        args,
        allowedTools: new Set([name]),
        approvedFilePaths: [String(args.path)],
      });
      expect(missingApproval).toEqual({
        allowed: false,
        reason: "approval_required",
      });

      const wrongPath = authorizeToolInvocation({
        toolName: name,
        args,
        allowedTools: new Set([name]),
        approvalState: "APPROVED",
        approvedFilePaths: ["different-file.txt"],
      });
      expect(wrongPath).toEqual({
        allowed: false,
        reason: "path_outside_approved_scope",
      });
    },
  );

  it.each([...EXECUTION_TOOLS])(
    "%s requires execution mode, approval, and an approved validation profile",
    async (name) => {
      const args = SAFE_ARGS[name]!;
      const deniedInReadOnlyMode = makeCall(name, args, { allowExecutionTools: false });
      const modeResult = await executeSingleTool(deniedInReadOnlyMode.options);
      expect(modeResult.kind).toBe("failed");
      if (modeResult.kind === "failed") {
        expect(modeResult.diagnosticCode).toBe("TOOL_UNAVAILABLE");
      }

      const missingApproval = authorizeToolInvocation({
        toolName: name,
        args,
        allowedTools: new Set([name]),
        approvedValidationProfiles: APPROVED_PROFILES,
      });
      expect(missingApproval.reason).toBe("approval_required");

      const wrongProfile = authorizeToolInvocation({
        toolName: name,
        args,
        allowedTools: new Set([name]),
        approvalState: "APPROVED",
        approvedValidationProfiles: ["not-the-requested-profile"],
      });
      expect(wrongProfile).toEqual({
        allowed: false,
        reason: "validation_profile_not_approved",
      });
    },
  );

  it.each([
    { name: "read_file", args: { path: "src/index.ts" } },
    { name: "read_file_range", args: { path: "src/index.ts", startLine: 1, endLine: 1 } },
    { name: "git_diff", args: { path: "src/index.ts" } },
  ])(
    "$name rejects a read outside the Mission's server-owned path scope",
    async ({ name, args }) => {
      const call = makeCall(name, args, { missionReadPathScope: ["different.ts"] });
      const result = await executeSingleTool(call.options);
      expect(result.kind).toBe("failed");
      if (result.kind === "failed") {
        expect(result.diagnosticCode).toBe("TOOL_UNAVAILABLE");
        expect(result.safeMessage).toContain("scope");
      }
      expect(call.readEvents).toHaveLength(0);
    },
  );

  it.each(["list_directory", "search_code"])(
    "%s is unavailable for a narrowly scoped Mission read",
    async (name) => {
      const call = makeCall(name, SAFE_ARGS[name]!, { missionReadPathScope: ["src/index.ts"] });
      const result = await executeSingleTool(call.options);
      expect(result.kind).toBe("failed");
      if (result.kind === "failed") {
        expect(result.diagnosticCode).toBe("TOOL_UNAVAILABLE");
        expect(result.safeMessage).toContain("not authorized");
      }
      expect(call.readEvents).toHaveLength(0);
    },
  );

  it.each([...PATH_TOOLS])(
    "%s does not read or stage content outside the project root",
    async (name) => {
      const args = { ...SAFE_ARGS[name]!, path: "../outside-secret.txt" };
      const call = makeCall(name, args, {
        ...(WRITE_TOOLS.has(name)
          ? { approvedFilePaths: ["../outside-secret.txt"] }
          : {}),
      });
      const result = await executeSingleTool(call.options);
      expect(visibleOutput(result)).not.toContain(TEST_ONLY_SECRET);
      expect(call.pendingChanges).toHaveLength(0);

      const absoluteArgs = { ...SAFE_ARGS[name]!, path: outsideSecretPath };
      const absoluteCall = makeCall(name, absoluteArgs, {
        ...(WRITE_TOOLS.has(name) ? { approvedFilePaths: [outsideSecretPath] } : {}),
      });
      const absoluteResult = await executeSingleTool(absoluteCall.options);
      expect(visibleOutput(absoluteResult)).not.toContain(TEST_ONLY_SECRET);
      expect(absoluteCall.pendingChanges).toHaveLength(0);
    },
  );

  it("blocks symlink reads and symlink-target mutation proposals", async () => {
    const readCall = makeCall("read_file", { path: "escape.txt" });
    const readResult = await executeSingleTool(readCall.options);
    expect(visibleOutput(readResult)).not.toContain(TEST_ONLY_SECRET);

    const writeCall = makeCall(
      "write_file",
      { path: "escape.txt", content: "overwrite", reason: "symlink attack" },
      { approvedFilePaths: ["escape.txt"] },
    );
    const writeResult = await executeSingleTool(writeCall.options);
    expect(visibleOutput(writeResult)).not.toContain(TEST_ONLY_SECRET);
    expect(writeCall.pendingChanges).toHaveLength(0);
    expect(await readFile(outsideSecretPath, "utf8")).toBe(TEST_ONLY_SECRET);
  });

  it("keeps sensitive files out of direct reads, directory listings, and search output", async () => {
    const direct = makeCall("read_file", { path: ".env" });
    const directResult = await executeSingleTool(direct.options);
    expect(visibleOutput(directResult)).not.toContain(TEST_ONLY_SECRET);

    const listing = makeCall("list_directory", { path: "." });
    const listingResult = await executeSingleTool(listing.options);
    expect(visibleOutput(listingResult)).not.toContain(".env");

    const search = makeCall("search_code", { pattern: TEST_ONLY_SECRET });
    const searchResult = await executeSingleTool(search.options);
    expect(visibleOutput(searchResult)).not.toContain(TEST_ONLY_SECRET);
  });

  it("keeps Git log and status confined to the selected repository, not a nested repository", async () => {
    const logCall = makeCall("git_log", {});
    const logResult = await executeSingleTool(logCall.options);
    expect(visibleOutput(logResult)).not.toContain("T8_NESTED_REPOSITORY_SENTINEL");

    const statusCall = makeCall("git_status", {});
    const statusResult = await executeSingleTool(statusCall.options);
    expect(visibleOutput(statusResult)).not.toContain("nested.ts");
  });

  it("rejects malicious search globs without exposing outside files", async () => {
    const properties = definitionFor("search_code").function.parameters.properties ?? {};
    const globName = Object.keys(properties).find((key) => key.toLowerCase().includes("glob"));
    if (!globName) {
      throw new Error("search_code schema must expose its bounded glob argument");
    }
    const call = makeCall("search_code", {
      ...SAFE_ARGS.search_code,
      [globName]: "../../**/*",
    });
    const result = await executeSingleTool(call.options);
    expect(visibleOutput(result)).not.toContain(TEST_ONLY_SECRET);
  });

  it("does not accept model-supplied shell text or invoke the command runner", async () => {
    const runner = vi.fn(commandRunner);
    const call = makeCall("run_command", {
      ...SAFE_ARGS.run_command,
      command: `touch ${path.join(fixtureRoot, "shell-injection-ran")}`,
    }, { commandRunner: runner });
    await expectInputRejected("run_command", {
      ...SAFE_ARGS.run_command,
      command: `touch ${path.join(fixtureRoot, "shell-injection-ran")}`,
    });
    expect(runner).not.toHaveBeenCalled();
    await expect(readFile(path.join(fixtureRoot, "shell-injection-ran"), "utf8"))
      .rejects.toMatchObject({ code: "ENOENT" });
    expect(call.options.commandRunner).toBe(runner);
  });

  it("bounds huge file reads and broad search output", async () => {
    const hugeRead = makeCall("read_file", { path: "huge.txt" });
    const hugeReadResult = await executeSingleTool(hugeRead.options);
    expect(hugeReadResult.kind).toBe("ok");
    expect(Buffer.byteLength(visibleOutput(hugeReadResult), "utf8")).toBeLessThan(256_000);

    const broadSearch = makeCall("search_code", { pattern: "MATCH_TOKEN", path: "bulk" });
    const searchResult = await executeSingleTool(broadSearch.options);
    expect(searchResult.kind).toBe("ok");
    expect(Buffer.byteLength(visibleOutput(searchResult), "utf8")).toBeLessThan(96_000);
  });

  it("bounds command output and reports in-flight cancellation as incomplete", async () => {
    const outputProfile: CommandProfile = {
      name: "fixture-output-bound",
      command: process.execPath,
      args: [
        "-e",
        "process.stdout.write('x'.repeat(10000)); setInterval(() => {}, 1000)",
      ],
      timeoutMs: 3_000,
      maxOutputBytes: 1_024,
    };
    const oversizedCall = makeCall(
      "run_command",
      { profile: outputProfile.name },
      {
        approvedValidationProfiles: [outputProfile.name],
        commandProfiles: [outputProfile],
        commandRunner: runRegisteredCommand,
      },
    );
    const oversizedResult = await executeSingleTool(oversizedCall.options);
    expect(oversizedResult.kind).toBe("ok");
    if (oversizedResult.kind === "ok") {
      const commandResult = JSON.parse(oversizedResult.output) as {
        truncated?: boolean;
        combinedOutput?: string;
      };
      expect(commandResult.truncated).toBe(true);
      expect(Buffer.byteLength(commandResult.combinedOutput ?? "", "utf8"))
        .toBeLessThanOrEqual(outputProfile.maxOutputBytes);
    }

    const controller = new AbortController();
    const abortingRunner: CommandRunner = async ({ signal }) => new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(new Error("fixture cancelled"));
        return;
      }
      signal?.addEventListener("abort", () => reject(new Error("fixture cancelled")), { once: true });
    });
    const cancelledCall = makeCall("run_command", SAFE_ARGS.run_command, {
      commandRunner: abortingRunner,
      signal: controller.signal,
    });
    const pending = executeSingleTool(cancelledCall.options);
    setTimeout(() => controller.abort(), 10);
    const cancelledResult = await pending;
    expect(cancelledResult.kind).toBe("failed");
    if (cancelledResult.kind === "failed") {
      expect(cancelledResult.failureKind).toBe("cancelled");
      expect(cancelledResult.diagnosticCode).toBe("TOOL_CANCELLED");
    }
    expect(cancelledCall.lifecycleEvents.map((event) => event.phase)).toEqual([
      "requested",
      "started",
      "cancelled",
    ]);
  });

  it.each(["revision", "scope", "manifest"] as const)(
    "misses the shared cache when %s changes",
    async (dimension) => {
    const changedReadManifest = TOOL_DEFINITIONS.map((tool) =>
      tool.function.name === "read_file"
        ? {
            ...tool,
            function: {
              ...tool.function,
              description: "T8 manifest revision with unchanged read authorization",
            },
          }
        : tool,
    ) as unknown as ToolLoopOpts["toolManifest"];

    const cache = new Map<string, string>();
    const readEvents: ReadOnlyToolInvocation[] = [];
    const observe = async (event: ReadOnlyToolInvocation) => {
      readEvents.push(event);
    };
    const base: Partial<ToolLoopOpts> = {
      cache,
      missionReadPathScope: ["src/index.ts"],
      onReadOnlyInvocation: observe,
    };
    await runT8ToolLoop("read_file", SAFE_ARGS.read_file, base);

    const changed: Partial<ToolLoopOpts> =
      dimension === "revision"
        ? {
            analysisCorrelation: {
              ...ANALYSIS_CORRELATION,
              projectRevision: "t8-revision-after-change",
            },
          }
        : dimension === "scope"
          ? { missionReadPathScope: ["src/index.ts", "src/other.ts"] }
          : { toolManifest: changedReadManifest };
    await runT8ToolLoop("read_file", SAFE_ARGS.read_file, {
      ...base,
      ...changed,
    });

    expect(
      readEvents.filter((event) => event.phase === "requested"),
      `cache must miss after ${dimension} changes`,
    ).toHaveLength(2);
    },
  );

  it("does not return a cached read after the current Mission scope rejects its path", async () => {
    const cache = new Map<string, string>();
    const resultSteps: Array<{ cached: boolean }> = [];
    await runT8ToolLoop("read_file", SAFE_ARGS.read_file, {
      cache,
      missionReadPathScope: ["src/index.ts"],
    });

    const second = await runT8ToolLoop("read_file", SAFE_ARGS.read_file, {
      cache,
      missionReadPathScope: [],
      onStep: (step) => {
        if (step.kind === "tool_result") {
          resultSteps.push({ cached: step.cached === true });
        }
      },
    });

    expect(resultSteps.at(-1)?.cached).toBe(false);
    expect(JSON.stringify(second.messages)).not.toContain("INVARIANT_FIXTURE");
    expect(JSON.stringify(second.messages)).toContain("outside the server-approved Mission read scope");
  });

  it.each(
    (["write_file", "replace_text", "run_validation", "run_command", "run_browser_validation"] as const)
      .flatMap((name) =>
        (["started", "completed"] as const).map((status) => ({ name, status })),
      ),
  )("$name does not dispatch again from a persisted $status marker", async ({ name, status }) => {
    const args = SAFE_ARGS[name] as Record<string, string>;
    const marker = {
      key: toolCacheKey(name, args),
      tool: name,
      args,
      status,
    } as NonNullable<ToolLoopOpts["priorToolCalls"]>[number];
    const validationSpy = vi.fn(validationRunner);
    const browserSpy = vi.fn(browserValidationRunner);
    const commandSpy = vi.fn(commandRunner);
    const run = await runT8ToolLoop(
      name,
      args,
      {
        priorToolCalls: [marker],
        validationRunner: validationSpy,
        browserValidationRunner: browserSpy,
        commandRunner: commandSpy,
      },
    );

    expect(run.result.kind).toBe("response");
    expect(JSON.stringify(run.messages)).toContain("SERVER_REPLAY_BLOCKED");
    expect(run.pendingChanges).toHaveLength(0);
    expect(validationSpy).not.toHaveBeenCalled();
    expect(browserSpy).not.toHaveBeenCalled();
    expect(commandSpy).not.toHaveBeenCalled();
  });

  it.each(TOOL_CASES)(
    "$name exposes a server-observable invocation lifecycle before success",
    async ({ name, args }) => {
      const call = makeCall(name, args);
      const result = await executeSingleTool(call.options);

      expect(result.kind, name).toBe("ok");
      expect(call.lifecycleEvents.map((event) => event.phase), name).toEqual([
        "requested",
        "started",
        "completed",
      ]);
      expect(call.lifecycleEvents.every((event) => event.toolName === name), name).toBe(true);
      expect(call.lifecycleEvents.every((event) => event.inputHash.length === 64), name).toBe(true);
    },
  );

  it("records a distinct STARTED phase instead of jumping from request to terminal", async () => {
    const call = makeCall("read_file", SAFE_ARGS.read_file);
    const result = await executeSingleTool(call.options);
    expect(result.kind).toBe("ok");
    expect(call.lifecycleEvents.map((event) => event.phase)).toEqual([
      "requested",
      "started",
      "completed",
    ]);
  });
});