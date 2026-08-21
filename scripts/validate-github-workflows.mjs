import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";

const root = fileURLToPath(new URL("..", import.meta.url));
const workflowsDirectory = join(root, ".github/workflows");
const workflowsLabel = ".github/workflows";

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

async function findWorkflowFiles(directory) {
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

async function validateWorkflow(workflowPath) {
  const label = workflowLabel(workflowPath);
  const source = await readFile(workflowPath, "utf8");
  let workflow;

  try {
    workflow = yaml.load(source, { filename: label });
  } catch (error) {
    const location = error.mark
      ? ` at line ${error.mark.line + 1}, column ${error.mark.column + 1}`
      : "";
    fail(workflowPath, `YAML syntax error${location}: ${error.reason ?? error.message}`);
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
    if (!job["runs-on"] && !job.uses) {
      fail(workflowPath, `job \`${jobId}\` must define either \`runs-on\` or \`uses\`.`);
    }
    if (job.steps !== undefined && !Array.isArray(job.steps)) {
      fail(workflowPath, `job \`${jobId}\` steps must be a YAML sequence.`);
    }
  }
}

try {
  const workflowFiles = await findWorkflowFiles(workflowsDirectory);
  if (workflowFiles.length === 0) {
    throw new Error(`${workflowsLabel}: no YAML workflow files found.`);
  }

  const failures = [];
  for (const workflowPath of workflowFiles) {
    try {
      await validateWorkflow(workflowPath);
    } catch (error) {
      failures.push(error.message);
    }
  }

  if (failures.length > 0) {
    throw new Error(failures.join("\n"));
  }

  console.log(
    `✅ ${workflowFiles.length} GitHub Actions workflow${workflowFiles.length === 1 ? "" : "s"} parse and have valid workflow/job structure.`,
  );
} catch (error) {
  console.error(`❌ GitHub Actions workflow validation failed: ${error.message}`);
  process.exitCode = 1;
}