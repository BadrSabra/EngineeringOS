---
name: Capability probe evidence boundary
description: Capability probes require complete named bodies plus independent, source-bound citations for every C1–C7 claim.
---

The capability probe must treat its two-file manifest as a hard completion
boundary: source labels, search hits, or a single retained body cannot promote a
C1–C7 response to a successful result. Each labelled claim must also carry its
own exact quoted fragment tied to a completed named source; one report-level
quote cannot close unrelated claims, and the final report must cite both named
files. For negative claims, the quoted fragment is executable context for the
completed-read boundary, not fabricated proof of absence.

**Why:** A provider can produce a plausible seven-line report from partial
context or attach one plausible quote to several unrelated answers; accepting
that would turn an evidence inventory into an unsupported capability verdict.
Even a live HTTP 200 with a terminal `done` event can still be
`ANALYSIS_INCOMPLETE` when the persisted evidence counts are zero.

**How to apply:** Keep the manifest shared by the canonical prompt and the
chat-agent completion gate. Missing, empty, or truncated bodies must remain an
explicit ANALYSIS_INCOMPLETE / not-proven outcome, while recovery may only use
already-retained reads. Bound citation recovery by the parent deadline and
reserve the final-output tail before starting provider calls.

Capability probes are their own evidence lane: do not run the generic behavior
evidence validator after the two named bodies are retained, and do not expose
search/list tools after complete prefetch. If prefetch is incomplete, recovery
may use only the two read tools within the manifest.

**Why:** The generic validator expects executable control-flow evidence for a
behavior answer and can reject valid C1–C7 results; open-ended search after
prefetch caused scope drift and consumed the synthesis budget without adding
accepted evidence.

**How to apply:** Let the probe-specific citation/claim validator own
acceptance, while the server-owned prefetch and read allow-list own scope.

The tool allow-list is a dispatcher fence, not a provider-manifest fence:
setting it to an empty set can still expose the original tool definitions to the
model, which then produces blocked tool-call loops.

**Why:** The latest live trace showed repeated `read_file` requests while the
dispatcher rejected them, consuming model turns without adding evidence.

**How to apply:** For no-tool synthesis, filter the tool definitions sent to the
provider as well as keeping the server-side dispatch authorization.

Durable execution checkpoint parsers must accept every evidence verdict that the
forensic diagnostic layer can emit, including explicit incomplete-claim verdicts.

**Why:** A terminal writer can persist a new verdict successfully while an
older parser silently drops it during reload, making a failed operation appear
to have no durable evidence classification.

**How to apply:** When adding or changing a forensic verdict, update the
checkpoint parser and add an integration assertion that reloads the terminal
checkpoint and verifies the verdict survives a rejected late write.

Near-JSON capability responses may be salvaged only when all seven C1–C7
fields are present; recovered lines must still pass the probe-specific semantic
and exact-source citation gates.

**Why:** Providers can return a complete capability record with a malformed
wrapper, but accepting partial field extraction would turn parser recovery into
invented evidence.

**How to apply:** Preserve only values already present in the provider
completion, reject incomplete JSON-like objects, and keep missing claims on the
incomplete path.