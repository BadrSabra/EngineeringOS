---
name: Project-query semantic acceptance
description: The acceptance boundary for proof-required project questions
---

For a proof-required `PROJECT_QUERY`, complete retained source reads are necessary but never sufficient for success. The execution must also carry project-query analysis evidence with accepted claims and a verified objective verdict; generic operation evidence must not be used as a fallback. Capability Probe contracts are a separate exception and keep their own gate.

**Why:** A blocked/no-answer analysis once had complete reads and was incorrectly persisted as `PROVEN/SUCCEEDED` because the generic acceptance path treated `source-read:*` references as proof.

**How to apply:** Keep the semantic gate in the durable completion path, and add regression coverage for complete reads with `OBJECTIVE_BLOCKED` plus a positive Capability Probe case.

Gap-analysis project queries use a server-owned `gap-analysis` target with bounded
source paths and required claims. This keeps generic "what gaps remain?" requests
on the `PROJECT_QUERY` contract without accepting an unscoped answer.

**Why:** Requiring proof without an objective correctly blocked false success, but
left generic gap questions unable to produce a valid successful analysis.

**How to apply:** Preserve the target/objective binding through session state,
SSE, history, and acceptance; broad audit wording must still require explicit
scope rather than silently becoming a targeted gap query.

For embedded-AI project queries, accepted claims and a PROVEN objective are
still insufficient when the response is only a symbol inventory. The final
answer must contain a bounded behavioral flow explanation; otherwise classify
it as `NO_ANSWER`/incomplete and keep the objective verdict blocked.

**Why:** A complete-read run could name every relevant function and cite exact
excerpts while never explaining routing, tool-loop, provider, or acceptance
behavior. Treating that inventory as an answer recreated the original false
success at a different layer.

**How to apply:** Keep the behavioral-flow check before telemetry finalization,
carry `OBJECTIVE_BLOCKED`/`NO_ANSWER` through SSE and history, and keep
forensic terminal diagnostics out of project-query projections.

For embedded-AI objectives, behavioral claim prose and source evidence needles
are separate contract fields: the prose must be asserted by the answer, while
the needle only locates a server-owned source window. Preserve both fields
through tool-loop and resumable session serialization.

**Why:** The behavioral assertions intentionally do not appear verbatim in
TypeScript source. Reusing prose as the source matcher either produced no
evidence or encouraged symbol inventory to masquerade as a behavioral answer.

**How to apply:** Materialize evidence from bounded `evidenceNeedles`, close a
claim only when its behavioral assertion is present in the response and the
needle is in accepted evidence, and keep generic gap-analysis claims unchanged.

The behavioral-flow predicate must count explicit sequencing markers in the
answer, not generic verbs that may appear inside cited source excerpts. For
`PROJECT_QUERY`, the objective verdict must use the project-query completion
gate rather than the reachability-only final-answer validator.

**Why:** A source-inventory fallback could satisfy a loose verb scan, while a
valid project answer could be downgraded because the reachability validator
requires claim validations that normal project queries do not produce.

**How to apply:** Require multiple same-language sequence markers such as
`first/then/finally` or their Arabic equivalents, and keep source grounding,
accepted claims, and the objective gate authoritative for project-query
completion.

Objective evidence closure does not by itself prove full user-request coverage. A target must model each requested deliverable, including bounded weakness/risk findings, or a response can be accepted while answering only the positive architecture claims.

**Why:** An embedded-AI request explicitly asked for weaknesses, but its server-owned target required only routing, tool-loop, and provider-dispatch claims. The run became `PROVEN/ACCEPTED` even though the assistant returned no weakness analysis.

**How to apply:** Derive bounded deliverable claims from the resolved request contract, preserve them in the objective and resume state, and require each deliverable to be either accepted with evidence or explicitly marked unverified/incomplete before terminal success.

Provider response validity is a separate precondition from HTTP success and tool-call presence. A response with `finish_reason="error"` must never enter the tool loop as a successful assistant turn.

**Why:** OpenRouter returned an error finish reason alongside tool calls; the compatibility client accepted it because it checked only content/tool-call presence, and the strategy logged `call_success`.

**How to apply:** Reject error finish reasons at normalization, classify them into bounded provider failure/fallback paths, and test that no tool result or successful acceptance can follow the malformed response.