---
name: Engineering Agent control-plane scope
description: Durable architecture decision for Engineering Agent continuity work.
---

For Engineering Agent continuity, treat Mission as the product-level Agent Run identity and add a server-owned control-decision/read-model layer over the existing Mission Runtime, not a replacement runtime. Keep approval, apply, commit, and delivery authorization bound to their existing scoped contracts; do not infer broad autonomy from a chat intent or UI mode.

**Why:** Existing Mission Runtime has durable scheduling and recovery, while Episode, execution, and canonical-proof records already participate in attempt- and revision-bound acceptance. A new scheduler or broad continue action could duplicate behavior or bypass approval and delivery gates.

**How to apply:** Plan Agent Workspace and continuity changes as identity linkage, an aggregated Mission-level projection, and deterministic control decisions. Preserve per-Goal approval, apply, and committed-proposal delivery paths; treat new autonomy modes as a separate explicit scope.
