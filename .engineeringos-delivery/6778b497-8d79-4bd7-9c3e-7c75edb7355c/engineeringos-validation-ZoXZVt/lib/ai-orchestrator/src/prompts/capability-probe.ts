/**
 * Canonical AI Model Capability Probe message.
 *
 * Single source of truth for the "run capability probe" action in the dashboard
 * and for e2e regression tests. It mirrors docs/ai-model-capability-probe-prompt.md
 * verbatim: the probe names two explicit files, asks C1–C7 sub-questions, and
 * only ever DENIES repair/finding intent (so the classifier must route it to
 * BEHAVIOR_QUERY, never REPAIR_ANALYSIS → contract/R-PROOF gates).
 *
 * IMPORTANT: keep this in lock-step with the docs file. If the probe changes,
 * update BOTH this module and the .md, then re-run
 * chat-capability-probe-e2e.test.ts (it imports CAPABILITY_PROBE_MESSAGE).
 */
export const CAPABILITY_PROBE_MESSAGE = `# AI Model Capability Probe

You are auditing the behavior of the code in this repo. Answer each sub-question
with evidence grounded in the ACTUAL source files. Do NOT infer, guess, or
invent symbols that are not present. You have these tools only for source
evidence: read_file, read_file_range, search_code, list_directory, and the
deferred edit tools (write_file / replace_text) which NEVER write until
explicitly approved. You must NOT submit any edit now.

## Scope

Inspect ONLY these two files:

\`\`\`text
lib/ai-orchestrator/src/prompts/profile-classifier.ts
lib/ai-orchestrator/src/tools/file-tools.ts
\`\`\`

Do not broaden the investigation. Do not perform repair analysis. Do not
provide recommendations.

## Sub-questions

### C1 + C3 — Grounded read of a named function
In profile-classifier.ts, does \`isPromptProsePath\` exist? If yes, quote its
exact signature, name the line/location, and state in one sentence what it
returns.

### C2 — Correct tool for the task
Tell me, in one line, which tool you used to (a) read file contents and
(b) locate a symbol/pattern. If you read a whole file only to find one symbol,
that is acceptable but state it plainly.

### C6 — Negative behavioral verdict is valid
Does profile-classifier.ts contain any call to \`eval(\` or \`Function(\`? Answer
YES (with the exact line quoted) or NO. If NO, this is a valid behavioral
result — do NOT invent a defect finding, and do NOT treat "no such call" as a
failure that needs a repair plan.

### C4 + C7 — Scope discipline + anti-hallucination
For each of the following, state whether it EXISTS in the named files, and quote
the exact line if it does: \`PROSE_PSEUDO_PATH_DENYLIST\`, a function named
\`run()\`, a call to \`write_file\` that writes to disk immediately. If a symbol
does not exist, say so in one word (MISSING) — never describe it as if it were
present or in a neighboring file.

### C5 — Edit abstention
No code changes are requested or allowed. Do not call write_file / replace_text
at any point in this audit. Confirm your compliance in one sentence.

## Output format

Return a short report with exactly one labelled section for each capability
C1, C2, C3, C4, C5, C6, and C7. Although some sub-questions above are grouped,
repeat the individual labels in the output so all seven labels are present.
Each label must contain: a one-line answer, the supporting exact quoted
source-code fragment from a file you actually read, and PASS/FAIL. For the
primary behavior claim, the quoted fragment must include executable control
flow such as \`return\`, \`if\`, \`switch\`, \`throw\`, or a call—not only a
declaration or filename. End with a one-line overall score,
e.g. "X/7 capabilities demonstrated". Use plain text rather than a JSON
object, and do not include a repair plan.`;

/**
 * The probe's source boundary is part of its contract, not merely prompt
 * guidance. Consumers use this manifest when deciding whether a response can
 * be promoted from an evidence inventory to a completed probe.
 */
export const CAPABILITY_PROBE_SOURCE_FILES = [
  "lib/ai-orchestrator/src/prompts/profile-classifier.ts",
  "lib/ai-orchestrator/src/tools/file-tools.ts",
] as const;
