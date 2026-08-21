import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";

const root = fileURLToPath(new URL("..", import.meta.url));
const workflowsDirectory = join(root, ".github/workflows");

function workflowLabel(workflowPath) {
  return relative(root, workflowPath).replaceAll("\\", "/");
}

function fail(workflowPath, message) {
  throw new Error(`${workflowLabel(workflowPath)}: ${message}`);
}

function assertMapping(workflowPath, value, description) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(workflowPath, `${description} must be a YAML mapping.`);
  }
}

function describeYamlType(value) {
  if (value === null) {
    return "null";
  }
  if (Array.isArray(value)) {
    return "a YAML sequence";
  }
  if (typeof value === "object") {
    return "a YAML mapping";
  }
  return `a ${typeof value}`;
}

function assertNonEmptyString(workflowPath, value, description) {
  if (typeof value !== "string" || value.trim() === "") {
    fail(
      workflowPath,
      `${description} must be a non-empty string (received ${describeYamlType(value)}).`,
    );
  }
}

function assertReusableWorkflowReference(workflowPath, value, jobId) {
  const localReference = /^\.\/\.github\/workflows\/[^/\s]+\.ya?ml$/;
  const externalReference =
    /^[^/\s]+\/[^/\s]+\/\.github\/workflows\/[^/\s]+\.ya?ml@[^\s@]+$/;

  if (!localReference.test(value) && !externalReference.test(value)) {
    fail(
      workflowPath,
      `job \`${jobId}\` \`uses\` must reference a reusable workflow as ` +
        "`./.github/workflows/<file>.yml` or " +
        "`<owner>/<repo>/.github/workflows/<file>.yml@<ref>` " +
        "(for example, add the workflow path and a version ref).",
    );
  }
}

export async function findWorkflowFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const entryPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await findWorkflowFiles(entryPath)));
    } else if (entry.isFile() && /\.(?:yml|yaml)$/i.test(entry.name)) {
      files.push(entryPath);
    }
  }

  return files.sort();
}

export async function validateWorkflow(workflowPath, rootDirectory = root) {
  const label = relative(rootDirectory, workflowPath).replaceAll("\\", "/");
  const source = await readFile(workflowPath, "utf8");
  let workflow;

  try {
    workflow = yaml.load(source, { filename: label });
  } catch (error) {
    const location = error.mark
      ? ` at line ${error.mark.line + 1}, column ${error.mark.column + 1}`
      : "";
    throw new Error(
      `${label}: YAML syntax error${location}: ${error.reason ?? error.message}`,
    );
  }

  assertMapping(workflowPath, workflow, "Workflow document");
  if (!workflow.name || typeof workflow.name !== "string") {
    fail(workflowPath, "top-level `name` must be a non-empty string.");
  }
  if (!Object.hasOwn(workflow, "on")) {
    fail(workflowPath, "top-level `on` trigger configuration is missing.");
  }
  assertMapping(workflowPath, workflow.jobs, "top-level `jobs`");

  const jobs = Object.entries(workflow.jobs);
  if (jobs.length === 0) {
    fail(workflowPath, "top-level `jobs` must define at least one job.");
  }

  for (const [jobId, job] of jobs) {
    assertMapping(workflowPath, job, `job \`${jobId}\``);
    if (Object.hasOwn(job, "runs-on")) {
      assertNonEmptyString(workflowPath, job["runs-on"], `job \`${jobId}\` \`runs-on\``);
    }
    if (Object.hasOwn(job, "uses")) {
      assertNonEmptyString(workflowPath, job.uses, `job \`${jobId}\` \`uses\``);
      assertReusableWorkflowReference(workflowPath, job.uses, jobId);
    }
    if (!Object.hasOwn(job, "runs-on") && !Object.hasOwn(job, "uses")) {
      fail(workflowPath, `job \`${jobId}\` must define either \`runs-on\` or \`uses\`.`);
    }
    if (job.steps !== undefined && !Array.isArray(job.steps)) {
      fail(workflowPath, `job \`${jobId}\` steps must be a YAML sequence.`);
    }
  }
}

export async function validateWorkflows(
  directory = workflowsDirectory,
  rootDirectory = root,
) {
  const workflowFiles = await findWorkflowFiles(directory);
  if (workflowFiles.length === 0) {
    throw new Error(
      `${relative(rootDirectory, directory).replaceAll("\\", "/")}: no YAML workflow files found.`,
    );
  }

  const failures = [];
  for (const workflowPath of workflowFiles) {
    try {
      await validateWorkflow(workflowPath, rootDirectory);
    } catch (error) {
      failures.push(error.message);
    }
  }

  if (failures.length > 0) {
    throw new Error(failures.join("\n"));
  }

  return workflowFiles;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const workflowFiles = await validateWorkflows();
    console.log(
      `✅ ${workflowFiles.length} GitHub Actions workflow${workflowFiles.length === 1 ? "" : "s"} parse and have valid workflow/job structure.`,
    );
  } catch (error) {
    console.error(`❌ GitHub Actions workflow validation failed: ${error.message}`);
    process.exitCode = 1;
  }
}