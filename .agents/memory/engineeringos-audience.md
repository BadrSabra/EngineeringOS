---
name: EngineeringOS audience
description: Product audience and UX implications for EngineeringOS.
---

EngineeringOS targets Arabic-speaking users without programming or engineering expertise. They should be able to request engineering work and understand its progress and verified outcome without learning internal terms.

**Why:** The user-provided product brief identifies this audience and experience as central to EngineeringOS.

**How to apply:** Keep the primary flow goal-first and plain-language, explain only the progress and decisions users need, and retain detailed technical evidence in optional advanced views.

The user considers the current frontend too complex: separate assistant, general chat, workflows, tasks, and other pages risk confusing nontechnical users. Make eligible backend capabilities easy to request through one goal-first conversation, without requiring users to choose an internal subsystem first.

**Why:** The user explicitly said this complexity could prevent people from benefiting from the backend.

**How to apply:** Audit real chat reachability against server-owned capability manifests and endpoints. Keep approval and evidence gates intact; make detailed operational pages optional, not a second required path for ordinary users.

Use replit.com as a product-experience reference; adapt its prompt-first entry and unified project workspace to EngineeringOS rather than reproducing a code-editor interface.

**Why:** The user stated that EngineeringOS should have a user experience inspired by replit.com.

**How to apply:** Bring the request, progress, and verified result into one coherent workspace for Arabic-speaking nontechnical users, while keeping advanced operational tools optional.

Localize direction at reviewed surfaces rather than globally flipping every
technical page. The navigation shell can be RTL while legacy page content keeps
its layout until its own direction and mixed code/path content are reviewed.

**Why:** Arabic navigation should not silently reverse unreviewed operational
tables, source paths, or embedded technical controls.

**How to apply:** Expand RTL deliberately with page-level verification; keep
Latin brands, source paths, and identifiers direction-isolated where needed.

Plain Arabic must still distinguish the user's main objective, its subordinate
steps, project tasks, and individual executions; do not call every level
«مهمة» as a shortcut.

**Why:** Those levels have different ownership, recovery and approval boundaries.
Collapsing their names can imply that reviewing or resuming one affects another.

**How to apply:** Explain the relationship in labels and forms. Translation is
presentation only: stored status/action codes and authorization stay unchanged.

Keep translated accessible names distinct when different controls share the
same verb, especially a drawer's backdrop and its close button.

**Why:** Collapsing formerly distinct names can make keyboard/screen-reader
navigation and exact-name assertions ambiguous despite unchanged actions.

**How to apply:** Identify the control or context in the Arabic name; preserve
focus return, Escape behavior, and the separate click handlers.

Describe diff-hunk toggles as selected/excluded («مختار» / «مستبعد»), not
as accepted/rejected proof. Keep plan approval, file application, Git commit,
and remote push explicitly distinct in Arabic.

**Why:** Default-selected hunks do not constitute write approval or evidence
acceptance. Git commit may include unrelated working-tree edits under the
existing endpoint, so translating its warning must preserve that consequence.

**How to apply:** Localize display only; retain the existing scope and mutation
gates and prominently preserve operation-specific warnings.

Configuration and availability feedback must not imply a successful AI run.

**Why:** A green readiness indicator can mislead the nontechnical audience into
reading configuration as verified execution or acceptance.

**How to apply:** Describe configuration as prepared for sending and qualify
availability by its recorded check; reserve completion claims for accepted work.

Avoid fixed free-tier quotas and model counts in provider-key setup guidance.

**Why:** Provider account limits and catalogs change independently of this app;
static marketing numbers can mislead users about availability and cost.

**How to apply:** Keep setup links and describe limits as provider-account
dependent. Do not change routing policy through setup copy.
