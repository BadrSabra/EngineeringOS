---
name: Live benchmark failure attribution
description: Attribute live benchmark failures from final fixture resolution and safe, server-owned evidence.
---

- Determine the effective target scope from the returned fixture after all builders and overrides, not from an intermediate target map.
- Keep provider availability, behavioral proof, and validation results separate. If diagnostics are unavailable or unsafe to disclose, report the observed failure without guessing a narrower cause.

**Why:** During a multi-file benchmark investigation, a base target map looked like production files, but the synthetic fixture builder replaced them with isolated scenario paths. The unsupported inference led to unnecessary suite-version changes.

**How to apply:** Before changing a benchmark contract or version after a live failure, verify the final resolved fixture, validation profile, and sanitized proof projection. Update failure analysis only with evidence those artifacts support.

- For long free-only clean-witness campaigns, resume from durable progress after a bounded timeout; retried `F`/`U` observations are not final evidence.

**Why:** A full campaign exceeded its default deadline, then completed on resume. Earlier `F`/`U` observations were rerun and could not authorize a baseline.

**How to apply:** Keep the campaign identity stable, increase only the bounded outer runtime as needed, and run baseline approval only after every case has a final observation and the approval gate passes.
