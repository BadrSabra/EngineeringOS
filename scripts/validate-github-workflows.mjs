import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";

const root = fileURLToPath(new URL("..", import.meta.url));
const workflowPath = join(root, ".github/workflows/ci.yml");
const workflowLabel = ".github/workflows/ci.yml";

function fail(message) {
  throw new Error(`${workflowLabel}: ${message}`);
}

function assertMapping(value, description) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(`${description} must be a YAML mapping.`);
  }
}

async function validateWorkflow() {
  const source = await readFile(workflowPath, "utf8");
  let workflow;

  try {
    workflow = yaml.load(source, { filename: workflowLabel });
  } catch (error) {
    const location = error.mark
      ? ` at line ${error.mark.line + 1}, column ${error.mark.column + 1}`
      : "";
    fail(`YAML syntax error${location}: ${error.reason ?? error.message}`);
  }

  assertMapping(workflow, "Workflow document");
  if (!workflow.name || typeof workflow.name !== "string") {
    fail("top-level `name` must be a non-empty string.");
  }
  if (!Object.hasOwn(workflow, "on")) {
    fail("top-level `on` trigger configuration is missing.");
  }
  assertMapping(workflow.jobs, "top-level `jobs`");

  const jobs = Object.entries(workflow.jobs);
  if (jobs.length === 0) {
    fail("top-level `jobs` must define at least one job.");
  }

  for (const [jobId, job] of jobs) {
    assertMapping(job, `job \`${jobId}\``);
    if (!job["runs-on"] && !job.uses) {
      fail(`job \`${jobId}\` must define either \`runs-on\` or \`uses\`.`);
    }
    if (job.steps !== undefined && !Array.isArray(job.steps)) {
      fail(`job \`${jobId}\` steps must be a YAML sequence.`);
    }
  }
}

try {
  await validateWorkflow();
  console.log(`✅ ${workflowLabel} parses and has a valid workflow/job structure.`);
} catch (error) {
  console.error(`❌ GitHub Actions workflow validation failed: ${error.message}`);
  process.exitCode = 1;
}