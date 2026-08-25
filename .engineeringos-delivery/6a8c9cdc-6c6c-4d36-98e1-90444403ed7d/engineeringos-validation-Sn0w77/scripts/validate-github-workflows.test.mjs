import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { validateWorkflows } from "./validate-github-workflows.mjs";

test("discovers nested workflows and reports every YAML parser location", async () => {
  const root = await mkdtemp(join(tmpdir(), "github-workflows-"));
  const workflowsDirectory = join(root, ".github", "workflows");

  try {
    await mkdir(join(workflowsDirectory, "nested"), { recursive: true });
    await writeFile(
      join(workflowsDirectory, "root.yml"),
      "name: Root\non: [push]\njobs:\n  build: [\n",
    );
    await writeFile(
      join(workflowsDirectory, "nested", "release.yaml"),
      "name: Release\non: [push]\njobs:\n  deploy: {\n",
    );

    await assert.rejects(
      validateWorkflows(workflowsDirectory, root),
      (error) => {
        assert.match(
          error.message,
          /\.github\/workflows\/root\.yml: YAML syntax error at line 5, column 1/,
        );
        assert.match(
          error.message,
          /\.github\/workflows\/nested\/release\.yaml: YAML syntax error at line 5, column 1/,
        );
        return true;
      },
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("reports structural failures from every parseable workflow", async () => {
  const root = await mkdtemp(join(tmpdir(), "github-workflows-"));
  const workflowsDirectory = join(root, ".github", "workflows");

  try {
    await mkdir(workflowsDirectory, { recursive: true });
    await writeFile(
      join(workflowsDirectory, "invalid-top-level.yml"),
      "name: Invalid top level\non: [push]\njobs: []\n",
    );
    await writeFile(
      join(workflowsDirectory, "invalid-job.yaml"),
      [
        "name: Invalid job",
        "on: [push]",
        "jobs:",
        "  build:",
        "    steps: []",
        "",
      ].join("\n"),
    );

    await assert.rejects(
      validateWorkflows(workflowsDirectory, root),
      (error) => {
        assert.match(
          error.message,
          /\.github\/workflows\/invalid-top-level\.yml: top-level `jobs` must be a YAML mapping\./,
        );
        assert.match(
          error.message,
          /\.github\/workflows\/invalid-job\.yaml: job `build` must define either `runs-on` or `uses`\./,
        );
        return true;
      },
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("reports structural failures with the complete path for nested workflows", async () => {
  const root = await mkdtemp(join(tmpdir(), "github-workflows-"));
  const workflowsDirectory = join(root, ".github", "workflows");
  const nestedWorkflowPath = join(
    workflowsDirectory,
    "deployment",
    "production",
    "release.yml",
  );

  try {
    await mkdir(join(workflowsDirectory, "deployment", "production"), {
      recursive: true,
    });
    await writeFile(
      nestedWorkflowPath,
      [
        "name: Invalid nested workflow",
        "on: [push]",
        "jobs:",
        "  deploy: []",
        "",
      ].join("\n"),
    );

    await assert.rejects(
      validateWorkflows(workflowsDirectory, root),
      (error) => {
        assert.match(
          error.message,
          /\.github\/workflows\/deployment\/production\/release\.yml: job `deploy` must be a YAML mapping\./,
        );
        return true;
      },
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("reports malformed steps collections from nested workflows", async () => {
  const root = await mkdtemp(join(tmpdir(), "github-workflows-"));
  const workflowsDirectory = join(root, ".github", "workflows");
  const nestedWorkflowPath = join(
    workflowsDirectory,
    "deployment",
    "production",
    "release.yml",
  );

  try {
    await mkdir(join(workflowsDirectory, "deployment", "production"), {
      recursive: true,
    });
    await writeFile(
      nestedWorkflowPath,
      [
        "name: Invalid nested workflow steps",
        "on: [push]",
        "jobs:",
        "  deploy:",
        "    runs-on: ubuntu-latest",
        "    steps: {}",
        "",
      ].join("\n"),
    );

    await assert.rejects(
      validateWorkflows(workflowsDirectory, root),
      (error) => {
        assert.match(
          error.message,
          /\.github\/workflows\/deployment\/production\/release\.yml: job `deploy` steps must be a YAML sequence\./,
        );
        return true;
      },
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("reports missing execution configuration from nested workflows", async () => {
  const root = await mkdtemp(join(tmpdir(), "github-workflows-"));
  const workflowsDirectory = join(root, ".github", "workflows");
  const nestedWorkflowPath = join(
    workflowsDirectory,
    "deployment",
    "production",
    "release.yml",
  );

  try {
    await mkdir(join(workflowsDirectory, "deployment", "production"), {
      recursive: true,
    });
    await writeFile(
      nestedWorkflowPath,
      [
        "name: Invalid nested workflow job",
        "on: [push]",
        "jobs:",
        "  deploy:",
        "    steps: []",
        "",
      ].join("\n"),
    );

    await assert.rejects(
      validateWorkflows(workflowsDirectory, root),
      (error) => {
        assert.match(
          error.message,
          /\.github\/workflows\/deployment\/production\/release\.yml: job `deploy` must define either `runs-on` or `uses`\./,
        );
        return true;
      },
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("reports malformed runner declarations from nested workflows", async () => {
  const root = await mkdtemp(join(tmpdir(), "github-workflows-"));
  const workflowsDirectory = join(root, ".github", "workflows");
  const malformedRunsOnPath = join(
    workflowsDirectory,
    "deployment",
    "staging",
    "runs-on.yml",
  );
  const malformedUsesPath = join(
    workflowsDirectory,
    "deployment",
    "staging",
    "uses.yml",
  );

  try {
    await mkdir(join(workflowsDirectory, "deployment", "staging"), {
      recursive: true,
    });
    await writeFile(
      malformedRunsOnPath,
      [
        "name: Invalid runner",
        "on: [push]",
        "jobs:",
        "  build:",
        "    runs-on:",
        "      labels: ubuntu-latest",
        "",
      ].join("\n"),
    );
    await writeFile(
      malformedUsesPath,
      [
        "name: Invalid reusable workflow",
        "on: [push]",
        "jobs:",
        "  deploy:",
        "    uses: [./.github/workflows/reusable.yml]",
        "",
      ].join("\n"),
    );

    await assert.rejects(
      validateWorkflows(workflowsDirectory, root),
      (error) => {
        assert.match(
          error.message,
          /\.github\/workflows\/deployment\/staging\/runs-on\.yml: job `build` `runs-on` must be a non-empty string \(received a YAML mapping\)\./,
        );
        assert.match(
          error.message,
          /\.github\/workflows\/deployment\/staging\/uses\.yml: job `deploy` `uses` must be a non-empty string \(received a YAML sequence\)\./,
        );
        return true;
      },
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("reports malformed reusable workflow references with the complete nested path and job ID", async () => {
  const root = await mkdtemp(join(tmpdir(), "github-workflows-"));
  const workflowsDirectory = join(root, ".github", "workflows");
  const nestedWorkflowPath = join(
    workflowsDirectory,
    "deployment",
    "production",
    "release.yml",
  );

  try {
    await mkdir(join(workflowsDirectory, "deployment", "production"), {
      recursive: true,
    });
    await writeFile(
      nestedWorkflowPath,
      [
        "name: Invalid reusable workflow reference",
        "on: [push]",
        "jobs:",
        "  deploy:",
        "    uses: ./.github/workflows/reusable.yml@main",
        "",
      ].join("\n"),
    );

    await assert.rejects(
      validateWorkflows(workflowsDirectory, root),
      (error) => {
        assert.match(
          error.message,
          /\.github\/workflows\/deployment\/production\/release\.yml: job `deploy` `uses` must reference a reusable workflow/,
        );
        assert.match(
          error.message,
          /add the workflow path and a version ref/,
        );
        return true;
      },
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("accepts local and external reusable workflow references", async () => {
  const root = await mkdtemp(join(tmpdir(), "github-workflows-"));
  const workflowsDirectory = join(root, ".github", "workflows");

  try {
    await mkdir(workflowsDirectory, { recursive: true });
    await writeFile(
      join(workflowsDirectory, "valid-references.yml"),
      [
        "name: Valid reusable workflow references",
        "on: [push]",
        "jobs:",
        "  local-yml:",
        "    uses: ./.github/workflows/reusable.yml",
        "  local-yaml:",
        "    uses: ./.github/workflows/reusable.yaml",
        "  external-tag:",
        "    uses: octo-org/example/.github/workflows/reusable.yml@v4",
        "  external-branch:",
        "    uses: octo-org/example/.github/workflows/reusable.yaml@main",
        "  external-commit:",
        "    uses: octo-org/example/.github/workflows/reusable.yml@0123456789abcdef0123456789abcdef01234567",
        "",
      ].join("\n"),
    );

    await assert.doesNotReject(validateWorkflows(workflowsDirectory, root));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
