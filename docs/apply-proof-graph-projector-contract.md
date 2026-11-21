# Apply Changes Proof Graph Projector — Contract

**Status:** Read-only Apply V2 projection; implementation is carried on the mainline-derived continuation of PR #42  
**Profile:** Mission-linked Apply Changes, one completed execution and one exact attempt  
**Kernel:** Existing Proof Graph v0 only; this document does not widen the v0 schema or its authority  
**Persistence:** No graph tables, new event types, or migrations

## 1. Purpose and authority

The projector reconstructs a bounded Proof Graph from server-owned Apply V2 records already persisted by the Apply pipeline. It is a diagnostic relationship view, not a second evidence ledger and not an acceptance mechanism.

The route authenticates project access, requires an explicit non-negative attempt, and executes the projector inside one PostgreSQL `REPEATABLE READ` transaction. The projector performs reads only.

The result keeps three verdicts/authorities distinct:

1. Canonical Apply Proof is reloaded through `loadCanonicalProof`.
2. Mission D2 is re-evaluated by the existing Apply Mission gate.
3. The Proof Graph validator reports structural validity only, with `STRUCTURE_ONLY_NO_EXECUTION_AUTHORITY`.

A structural PASS does not create Acceptance, materialize World State, promote files, execute a mutation, or release Mission successors.

## 2. Durable source identity

Every projected DATA node uses a row-addressable reference in the form `db:<schema-table-symbol>/<row-id>`. The reference is not a synthetic execution label.

| Graph evidence | Durable source |
|---|---|
| Authorization decision | The exact `ACTION_REQUESTED` Episode event carrying the validated decision |
| Scope | The exact Change Proposal row |
| Preconditions | One DATA node per Journal row referenced by the validated precondition receipt |
| Parent World snapshot | The exact World Transition row containing the bound parent revision and fact references |
| Candidate workspace base | The direct observation row bound to the candidate identity |
| Live workspace base | Separate direct observation row(s) bound to the project identity |
| Candidate effect | The direct post-Apply observation row bound to the candidate identity |
| Live effect | Separate direct observation row(s) bound to the project identity |
| Acceptance | The exact Acceptance row and the exact evidence snapshot row, represented separately |
| Materialized World Transition | The exact World Transition row |

The projector verifies the observation role, subject, value, digest, completeness, freshness, environment freshness, and environment-revision binding before building the graph. Candidate observations are never substituted for project/live observations or merged into the same DATA node.

The evidence payload hash is computed from each projected node's source content. The row reference establishes where the content came from; the hash makes the projection deterministic and tamper-evident within the selected snapshot.

## 3. Freshness and revision semantics

Freshness is carried explicitly by each DataSpec and is assigned only after the source row has been reloaded and its profile-specific bindings have passed validation. The node constructor does not silently default every source to `fresh`.

The existing v0 kernel has only three revision domains: `WORLD`, `WORKSPACE_TREE`, and `PLAN`. It has no independent `ENVIRONMENT` domain. The projector therefore checks the Episode/environment revision against the direct observations and the World Transition before projection, but v0 does not expose Environment as a first-class graph revision axis.

Likewise, v0 fixes `PRECONDITION` evidence to the `WORLD` revision domain. Journal rows are projected individually and remain identifiable, but this does not claim that every Journal check is intrinsically a World-domain fact. A future typed successor contract must model the actual revision domain of each precondition (including Workspace and Environment where applicable) rather than weakening or rewriting v0.

Do not use this Apply/v0 profile as a universal proof profile for Runtime Start, Tasks, Workflows, or arbitrary mutation types.

## 4. Structural model

The projector uses the existing v0 control set:

- `AUTHORIZATION_VALID`
- `SCOPE_MATCHED`
- `PRECONDITIONS_SATISFIED`
- `PARENT_REVISION_MATCHED`
- `WORKSPACE_BASE_REVISION_MATCHED`
- `EFFECT_PROVEN`
- `ACCEPTANCE_SUCCEEDED`
- `WORLD_TRANSITION_MATERIALIZED`

Evidence that is plural in the source is represented by plural DATA nodes and matching support/binding edges. This includes Journal rows, live observations, and the separate Acceptance/evidence-snapshot records. Control evidence references must match the complete set of supporting DATA nodes.

The projection remains bounded by the v0 contract limits. More than 64 supporting references for a single control is not truncated; projection is rejected as `GRAPH_INVALID`.

## 5. Explicit non-goals

- No change to Canonical Proof, Mission D2, Acceptance, World Transition, Apply authorization, or file-promotion semantics.
- No client-submitted graph or proof labels accepted as source evidence.
- No graph persistence, migrations, new event ledger, Dashboard rendering, or runtime dispatcher integration.
- No attempt to encode Environment as a fake WORLD or WORKSPACE revision.
- No claim that kernel PASS independently proves source authenticity; source authentication remains the projector's server-side responsibility.

## 6. Required verification

The PostgreSQL integration test covers:

- Positive projection from a completed Apply V2 execution.
- Stable graph hash across repeated reads.
- Explicit-attempt mismatch rejection.
- Candidate/live observation separation and rejection of identity substitution.
- Journal payload tampering rejection.
- Before/after snapshots showing no Acceptance, World Transition, or World Fact writes caused by projection.

Typecheck, focused PostgreSQL integration, and the full CI/release checks must pass on the current PR head before this contract is considered verified for merge.
