# P7.5 Claim-to-Authority Decision Record

**Decision date:** 2026-09-28
**Status:** Owner decision values recorded; runtime evidence verification and collection remain blocked.

## Decision boundary

These are governance decisions, not runtime evidence states:

- `QUALIFIED_SOURCE` selects an existing source for a later, separate verifier. It does not prove that evidence is authentic, current, in scope, or sufficient.
- `NO_QUALIFIED_SOURCE` records that no currently known source qualifies. The claim remains blocked; no replacement source is created.
- `HUMAN_AUTHORITY_REQUIRED` requires a designated human authority or review process. It is not the runtime state `HUMAN_REVIEW_REQUIRED`.
- `DEFERRED` postpones the decision and keeps the claim blocked.

Runtime evidence continues to use `SERVER_VERIFIED`, `HUMAN_REVIEW_REQUIRED`,
`MISSING`, `UNVERIFIABLE`, `CONFLICTING`, and `OUT_OF_SCOPE`. None of the
governance decisions below changes a runtime evidence state or collection
authorization.

## Seven-claim owner decisions

| Claim ID | Claim | Inventory facts | Recorded decision |
|---|---|---|---|
| `reviewer-identity` | Bind reviewer identity to a P7.5 review record. | `clerk-session-identity` identifies a signed-in user/session; no P7.5 review record currently binds it to a pack and protocol. | `QUALIFIED_SOURCE` — Clerk identity only. It does not establish reviewer authority or approval. |
| `reviewer-authority-and-approval` | Verify reviewer authority and approval for the exact protocol revision. | `server-operator-allowlist` is a general operator gate, not a P7.5 reviewer policy; no P7.5 approval record was found. | `HUMAN_AUTHORITY_REQUIRED` — require designated P7.5 authority and explicit approval. |
| `controlled-environment-reset` | Verify a repeatable, operator-reviewed reset and controlled environment scope. | The Episode ledger records event provenance; generic task attestations are caller-submitted; no P7.5 reset record was found. | `HUMAN_AUTHORITY_REQUIRED` — require operator control and durable reset evidence. |
| `independent-sampling-definition` | Verify sampling independence and rule out automatic reuse. | No trusted cohort/sample-selection lineage was found; distinct Mission IDs do not prove independent selection. | `NO_QUALIFIED_SOURCE` — none identified in the current inventory. |
| `heldout-provenance` | Verify held-out outcomes were not used to tune forecast, policy, probe, or evaluator. | `fixed-heldout-partition` is a label only; no dataset lineage or tuning history was found. | `NO_QUALIFIED_SOURCE` — none identified in the current inventory. |
| `forecast-and-policy-freeze` | Verify forecast, hypothesis, decision mapping, probe, evaluator, policy, and scope were frozen before outcomes. | The protocol manifest hashes current identifiers but does not prove a trusted pre-outcome freeze; no approval/freeze record was found. | `HUMAN_AUTHORITY_REQUIRED` — require protocol-owner approval before the first outcome. |
| `evaluator-applicability` | Independently review sample sufficiency and evaluator limitations. | Evaluator identity is present in the protocol manifest; no authorized applicability/sufficiency review was found. | `HUMAN_AUTHORITY_REQUIRED` — require independent review of sufficiency and limitations. |

## Binding requirements and remaining blockers

The Clerk source is selected for authenticated account/session identity only.
A future verifier must bind that identity to a durable P7.5 review record, the
exact pack, and the exact protocol revision. That binding does not confer
reviewer authority. No reviewer-approval or reset mechanism is selected here.

For every future evidence binding, record the issuer, authority basis, exact
claim and scope, protocol revision, validity window, invalidation conditions,
and conflict-resolution rule. Existing source presence or a recorded decision
must not be hard-coded as `SERVER_VERIFIED`.

## Guardrails

- Do not infer additional authority or evidence from source presence, caller claims, hashes, or examples.
- Do not add IAM, approval storage, an endpoint, Dashboard controls, a cohort, a selector, a verifier, or collection authorization as part of this decision record.
- P7.5 remains `BLOCKED`; `collectionAuthorized=false`; `fixed_safe_probe` remains unchanged.
- `NO_QUALIFIED_SOURCE` and `DEFERRED` keep their claims blocked. `HUMAN_AUTHORITY_REQUIRED` remains distinct from runtime `HUMAN_REVIEW_REQUIRED`.