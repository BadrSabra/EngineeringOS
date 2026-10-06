---
name: AI fixture determinism
description: Rules for preventing test fixtures from silently running real validators or masking missing AI turns.
---

AI integration fixtures must consume injected validation results and provider turns explicitly; an exhausted fixture queue should throw immediately rather than run a real command, call a live provider, or synthesize an untracked success.

**Why:** Silent fallbacks make deterministic route tests pass while exercising the workspace or external AI unexpectedly, and they hide missing tool/validation steps in the scenario.

**How to apply:** Keep real validation behind an explicit opt-in flag, use mutable hoisted state when tests reset it, and fail with a fixture-specific error whenever a required injected result is absent.

Provider-failure fixtures that exercise the real fallback helper must fail every configured candidate explicitly; a one-shot rejection can be consumed by the first candidate and silently turn the test into a success-path assertion.

**Why:** The fallback helper intentionally continues after a provider error, so a single mocked rejection does not prove the terminal failure contract.

**How to apply:** Match the fixture's configured provider count with rejected turns, or mock the fallback boundary directly when the scenario is not testing fallback traversal.

Module-level classifier mocks in route integration suites must reset to the real classifier after every test; `restoreAllMocks()` alone does not clear `mockReturnValueOnce` or `mockReturnValue` state on a standalone `vi.fn`.

**Why:** A leaked classification can change a later request's persisted task contract, making tests pass or fail based on file order rather than the request under test.

**How to apply:** Reset the mocked classifier in teardown and set explicit forensic/project-query classifications inside tests that depend on one.

Chat-history projection tests should mock the episode-ledger persistence boundary instead of emulating its tables, while retaining real execution-lease ownership checks.

**Why:** Expanding a generic database mock to reproduce ledger transactions couples an unrelated projection test to persistence internals and can obscure whether lease checks still run.

**How to apply:** When ledger durability is not the subject, isolate that boundary in route tests; preserve the lease-selection and ownership path, and cover ledger transactions in dedicated ledger tests.

Chat UI fixtures should keep unselected-session and selected-session message data scoped to the behavior under test; globally changing array identity can erase optimistic messages during selection hydration and break unrelated stream tests.

**Why:** AiChat resets visible messages when session selection changes, while its stream path also protects transient messages during server hydration.

**How to apply:** For restored-session and handoff tests, provide a session-specific message response; avoid changing the shared message-hook mock's identity semantics unless testing that transition.

Lifecycle recovery tests that execute the production chat helper should preserve provider eligibility and budget admission, replacing only provider strategy construction and lifecycle/circuit readiness with deterministic fixtures. Budget reservations cascade with a unique project, but usage and operator-alert rows need explicit cleanup scoped to that project and owner.

**Why:** Stubbing the helper hides service-to-engine forwarding; stubbing admission hides a real production boundary and can leave durable test rows behind.

**How to apply:** Keep service-owned scope, tool manifests, and observation callbacks intact; activate only the fixture provider, await asynchronous observations, and clean side effects by unique fixture identity rather than shared user.

Durable Mission tool fixtures must assert the provider-visible tool list after routing, not only the service allowlist. Validation tools must carry the plan-selected profile in the server-owned approval manifest.

**Why:** Natural-language routing can narrow an otherwise authorized request to forensic tools, while a fake provider can emit a tool absent from its manifest; missing profile approval correctly blocks dispatch.

**How to apply:** Exercise the production chat helper, assert the requested tool appears in provider options, and keep the validation runner server-owned and limited to the Mission policy profile.