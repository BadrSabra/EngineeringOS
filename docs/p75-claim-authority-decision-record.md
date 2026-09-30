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

## Identity-binding feasibility (read-only audit, 2026-09-28)

**Outcome: no existing trusted binding was found.** Current durable records do
not establish that a Clerk account/session performed this exact P7.5 review for
the exact evidence pack, protocol revision, scope, and validity window.

The audit found:

- Clerk authentication exposes an authenticated user and session to request
  handlers, but no P7.5 review action currently persists their binding to a
  review, evidence-pack hash, or protocol revision.
- The Episode ledger durably records execution events and P7.5 experiment
  registration/result payloads. Those are execution provenance, not a reviewer
  action. Their current P7.5 payload contract has no review identity or review
  binding.
- Generic task verification retains an authenticated actor, submitted text
  evidence, and task/check history. It is task-scoped and caller-attested; it
  does not bind a P7.5 review, pack hash, protocol revision, scope, or validity.
  The generic audit log likewise records actor/entity/action snapshots, not
  those review-specific semantics.
- Protocol and payload hashes identify content; they do not bind the Clerk
  identity to a review of that exact content.
- A read-only query of the development Episode-event table found no records
  whose payload `recordKind` starts with `P75`. This is a point-in-time
  development observation, not a claim about other environments.

**Required invariant:** the same authenticated Clerk user/session is not the
same review. Any future trusted binding must relate the identity to an exact
`reviewId`, evidence-pack hash, protocol revision, scope, and validity window,
with explicit invalidation and conflict handling. Identity alone must never
select a different review implicitly.

For this identity-binding claim, `MISSING`, `EXPIRED`, `REVOKED`, `CONFLICTING`,
and `OUT_OF_SCOPE` all block. Missing or invalid identity binding must not fall
back to `HUMAN_REVIEW_REQUIRED`; that runtime state would require a separate,
bound, independently verifiable human-review record. These semantics are
documented only and do not add runtime states or change current evidence.

The result is the insufficient-source branch: P7.5 identity binding remains
blocked until a separate scope authorizes an adequate binding mechanism. No
storage, IAM, endpoint, Dashboard control, verifier, or collection authority
is added here.

## Seven-claim source coverage (read-only audit, 2026-09-28)

**Outcome: no inspected source covers the complete evidence contract for any
of the seven claims.** This is a source/code inventory, not acceptance of
evidence or a claim that no relevant record could exist in another environment.
No database was queried in this audit.

The audit distinguishes three things: a schema or payload contract that could
hold data, a writer that actually persists a record, and observed rows in a
specific database. Episode and generic task/audit records have durable writers;
the P7.5 readiness, manifest, and calibration objects are generated artifacts
unless separately persisted. The earlier development-database observation in
the identity audit remains point-in-time only.

| Claim | Existing source/capability | Missing proof |
|---|---|---|
| `reviewer-identity` | Clerk middleware exposes `userId`, `sessionId`, and `orgId` to request handlers. Episode events persist actor, payload/hash, sequence, and time; generic task verification retains actor and submitted check evidence. | No writer binds Clerk identity to an exact `reviewId`, evidence-pack hash, protocol revision, scope, and validity window. Actor IDs and payload hashes are provenance/content identifiers, not review identity. |
| `reviewer-authority-and-approval` | The server operator gate checks the general `ADMIN_USER_IDS` list. Generic audit records retain actor/entity/action snapshots and timestamps; task verification records caller-submitted results. | No P7.5 reviewer designation or approval writer binds authorized authority, explicit approval, exact pack/protocol, approval validity, and revocation/conflict rules. The general operator gate and audit action labels do not establish P7.5 authority. |
| `controlled-environment-reset` | Episode records and events retain execution, scope, revision, actor, and ordered-event provenance. P7.5 registration includes environment/project revisions and pre-state observation references. | No reset procedure/version, before/after environment inventory, operator review, repeatability evidence, or controlled-scope attestation is persisted. Execution actor and environment revision do not prove a controlled reset. |
| `independent-sampling-definition` | P7.5 readiness and calibration objects report counts, including distinct/independent Mission counts; the readiness contract explicitly says Mission count is not proof of independence. | No sampling frame, cohort/selector/seed, eligibility/exclusion history, draw lineage, reuse detection, or independent issuer is persisted. Distinct Mission IDs and counts cannot establish independent selection. |
| `heldout-provenance` | Registration/result contracts identify the literal evaluation partition and calibration scope/policy; calibration objects include partition and source-manifest hash. | No dataset membership/version lineage, split/acquisition history, prior exposure, tuning inputs/jobs, or pre-outcome non-use attestation is bound to the outcomes. A partition label or hash is not held-out provenance. |
| `forecast-and-policy-freeze` | The manifest identifies protocol, calibration, evaluator, policy, scope, partition, and content hashes. Registration records forecast/hypothesis/decision-map versions, `fixed_safe_probe`, and prediction time. | No durable immutable pre-outcome freeze event, proof of ordering before outcomes, authorized approver, append-only lock, or invalidation/conflict rule binds the full forecast/policy/scope set. Hashes identify content, not when or by whom it was frozen. |
| `evaluator-applicability` | Calibration objects report method/version, partition, counts, Brier/ECE metrics, and manifest hash. The calibration logic applies mechanical count/error thresholds. | No independent authorized assessment binds sample sufficiency, target/population applicability, evaluator limitations, scope, and review validity. Passing mechanical thresholds does not prove independent applicability review. |

**Source references:** Clerk context is assembled in
`artifacts/api-server/src/middlewares/requireAuth.ts`; general operator identity
is checked there, not through a P7.5 reviewer policy. Episode fields and event
writer are defined in `lib/db/src/schema/ai_agent_episodes.ts` and the P7.5
ledger writer/reader in
`artifacts/api-server/src/lib/agent-state/runtime-start-hypothesis-experiment.ts`.
Generic task verification and audit records are written by
`artifacts/api-server/src/routes/tasks.ts` and described by
`lib/db/src/schema/tasks.ts` and `lib/db/src/schema/audit_logs.ts`. P7.5
readiness/calibration fields and thresholds are defined in
`artifacts/api-server/src/lib/agent-state/runtime-start-hypothesis-calibration-readiness.ts`
and `runtime-start-hypothesis-calibration.ts`; the manifest/evidence-pack
contract is in `runtime-start-hypothesis-readiness-evidence-pack.ts`.

The current runtime trust boundary still reports all seven checks as
`MISSING` with empty `evidenceRefs`. The pack remains diagnostic:
`collectionAuthorized=false`, `writesPerformed=false`, and
`selectionMode=fixed_safe_probe`. No runtime, schema, writer, verifier, IAM,
endpoint, Dashboard control, or collection permission is added by this audit.

## Development-data shadow check (read-only, 2026-09-28)

This separate check queried aggregate counts and exact key/text-marker
presence in the development database only. It returned no record IDs, actors,
or evidence text, and performed no writes.

- `ai_agent_episode_events`: 404 rows; 0 payloads had a `P75*` `recordKind`,
  `P75`/`reviewId` text markers, `evidencePackHash`/`protocolRevision`
  markers, or `validUntil`/`validityWindow` markers.
- `tasks`: 11 rows, 1 non-null `verification_result`; 0 such results mentioned
  `P75`, `reviewId`, `evidencePackHash`, or `protocolRevision`.
- `audit_logs`: 1,033 rows; 0 selected JSON snapshots contained those P7.5
  markers or the exact review/pack/protocol keys.
- No public table name matched `p75`, `calibration`, `review`, `approval`,
  `reset`, `cohort`, `holdout`, or `sampling`.

This point-in-time development result adds no candidate P7.5 binding to the
source inventory. The checks were limited to known tables, exact canonical key
names, and the listed text markers; they do not establish absence in another
environment or in an unrelated store/encoding. All seven runtime checks
remain `MISSING`; the pack remains `BLOCKED`,
`collectionAuthorized=false`, and `fixed_safe_probe`.

## Future proof obligations (design only)

This is a requirements outline for a separately authorized design or
implementation task. It does not define runtime fields, add states, select a
source, or authorize collection. The listed attributes are conceptual
obligations, not proposed database column names.

Any future claim evidence must bind a stable source record reference and content
hash to the exact claim and scope, protocol revision where applicable, issuer,
and authority basis. It must also carry the observation time, validity window,
invalidation/revocation conditions, and conflict-resolution rule. A hash proves
content identity only; it does not prove issuer authority, review identity, or
that a freeze preceded outcomes.

| Claim | Claim-specific proof obligations |
|---|---|
| `reviewer-identity` | Authenticated Clerk subject/session bound to an exact `reviewId`, evidence-pack hash, protocol revision, scope, and validity window. The same account/session alone is not the review. |
| `reviewer-authority-and-approval` | Designated P7.5 authority basis and explicit review decision bound to that same review/pack/protocol/scope; include decision time, validity, revocation, and conflict handling. Account identity or a general operator allowlist is insufficient. |
| `controlled-environment-reset` | Versioned reset procedure; controlled environment/project scope; verified pre-reset and post-reset state; authorized operator; repeatability evidence; and validity/invalidation conditions. Execution or environment revision alone is insufficient. |
| `independent-sampling-definition` | Defined target population and sampling frame; selection method/version and auditable draw lineage; eligibility/exclusion and reuse handling; and an independent source/issuer. Distinct Mission IDs or aggregate counts are insufficient. |
| `heldout-provenance` | A versioned prior dataset or prospective outcome stream, with eligibility/partition rules frozen before the first outcome, per-unit origin and membership bound before its prediction, and continuous access/tuning history for forecast, hypotheses, policy, probe, and evaluator. Prove no evaluation outcome informed the in-scope policy, including later tuning. A partition label/hash or missing access history is insufficient. |
| `forecast-and-policy-freeze` | Exact hashes/versions for forecast, hypotheses, decision mapping, probe, evaluator, policy, and scope; trusted freeze time demonstrably before outcomes; authorized owner/approver; and tamper, invalidation, and conflict semantics. |
| `evaluator-applicability` | Evaluator/method version; target population, objective, and scope; independent assessment of sample sufficiency and limitations; reviewer authority; and review validity. Mechanical calibration thresholds alone are insufficient. |

`EXPIRED` and `REVOKED` describe blocking reasons, not new runtime states in
this design. Missing, expired, revoked, conflicting, and out-of-scope evidence
must block. `HUMAN_REVIEW_REQUIRED` is permitted only when a separate, bound,
independently verifiable human-review record exists; absence of a source is not
a fallback to human review.

If a future task is authorized, use the existing intent/planning, server-owned
read tools, retained-evidence, and acceptance/proof layers. The model may help
locate candidate records, but only a server-owned verifier may classify their
authority and evidence state. Do not add a second planner/executor or infer
trust from provider prose. Collection approval remains a separate gate.

## Guardrails

- The proposed operating procedure in
  `docs/p75-sampling-heldout-governance-procedure.md` was authorized for
  design only on 2026-09-30. No issuer, source, reviewer, or authority basis
  was designated; the two `NO_QUALIFIED_SOURCE` decisions above are unchanged.
- Do not infer additional authority or evidence from source presence, caller claims, hashes, or examples.
- Do not add IAM, approval storage, an endpoint, Dashboard controls, a cohort, a selector, a verifier, or collection authorization as part of this decision record.
- P7.5 remains `BLOCKED`; `collectionAuthorized=false`; `fixed_safe_probe` remains unchanged.
- `NO_QUALIFIED_SOURCE` and `DEFERRED` keep their claims blocked. `HUMAN_AUTHORITY_REQUIRED` remains distinct from runtime `HUMAN_REVIEW_REQUIRED`.