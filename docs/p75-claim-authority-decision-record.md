# P7.5 Claim-to-Authority Decision Record

**Status:** Owner decisions not recorded. No source has been selected or qualified.
**Purpose:** Record the owner's governance decision for each P7.5 trust claim without turning that decision into runtime evidence or collection authority.

## Decision boundary

The following are governance decision values, not runtime evidence states:

- `QUALIFIED_SOURCE` — the owner selects an existing source for a later, separate verifier. This does not prove that a particular evidence item is authentic, current, in scope, or sufficient.
- `NO_QUALIFIED_SOURCE` — the owner records that no currently known source qualifies. The claim remains blocked; this does not create a replacement source.
- `HUMAN_AUTHORITY_REQUIRED` — the owner records that the claim requires a designated human authority or review process. This is not the runtime state `HUMAN_REVIEW_REQUIRED`.
- `DEFERRED` — the owner postpones the decision. The claim remains blocked.

Runtime evidence continues to use `SERVER_VERIFIED`, `HUMAN_REVIEW_REQUIRED`,
`MISSING`, `UNVERIFIABLE`, `CONFLICTING`, and `OUT_OF_SCOPE`. A governance
decision must not be hard-coded as a trusted source in
`runtime-start-hypothesis-trust-boundary.ts`. A later verifier must independently
bind actual evidence to the selected source, issuer, claim, scope, and protocol.

The decision value below is intentionally **not recorded yet**. “Not recorded”
is a form-completion marker, not a fifth governance decision status.

## Seven-claim owner decision table

For every claim, record the selected governance value and, where relevant, the
source, issuer, authority basis, exact claim and scope, protocol revision,
validity window, invalidation conditions, and conflict-resolution rule. The
inventory facts are context only; they do not imply that any source is qualified.

| Claim ID | Claim to decide | Current inventory facts (not authority) | Owner decision |
|---|---|---|---|
| `reviewer-identity` | Bind a reviewer identity to a P7.5 review record. | `clerk-session-identity` identifies a signed-in user/session; no P7.5 review record binds that identity to a pack and protocol. | **Not recorded.** |
| `reviewer-authority-and-approval` | Verify reviewer authority and approval for the exact protocol revision. | `server-operator-allowlist` gates general operator routes but is not a P7.5 reviewer policy; no P7.5 approval record was found. | **Not recorded.** |
| `controlled-environment-reset` | Verify a repeatable, operator-reviewed reset procedure and controlled environment scope. | `episode-ledger` records event provenance; generic task attestations are caller-submitted; no P7.5 controlled-reset record was found. | **Not recorded.** |
| `independent-sampling-definition` | Verify a sampling definition that establishes independence and rules out automatic reuse. | No trusted cohort/sample-selection lineage was found; distinct Mission IDs do not prove independent selection. | **Not recorded.** |
| `held-out-provenance` | Verify held-out outcomes were not used for forecast, policy, probe, or evaluator tuning. | `fixed-heldout-partition` supplies a label only; no held-out dataset lineage or tuning history was found. | **Not recorded.** |
| `forecast-and-policy-freeze` | Verify forecast, hypothesis, decision mapping, probe, evaluator, policy, and scope were frozen before outcomes. | `protocol-manifest` hashes current identifiers but does not prove a trusted pre-outcome freeze; no P7.5 approval/freeze record was found. | **Not recorded.** |
| `evaluator-applicability` | Obtain an independent review of sample sufficiency and evaluator limitations. | Evaluator identity is present in the protocol manifest; no authorized applicability/sufficiency review was found. | **Not recorded.** |

## Guardrails

- Do not infer an owner decision from source presence, a caller claim, a hash, or an example in this document.
- Do not add IAM, approval storage, an endpoint, Dashboard controls, a cohort, a selector, a verifier, or collection authorization as part of filling this record.
- Until owner decisions and later independent evidence verification are complete, P7.5 remains `BLOCKED`, `collectionAuthorized=false`, and `fixed_safe_probe` remains unchanged.
- A decision of `NO_QUALIFIED_SOURCE` or `DEFERRED` is a valid governance outcome and keeps the claim blocked.