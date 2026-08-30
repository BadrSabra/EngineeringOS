---
name: Groq model lifecycle
description: How to prevent valid Groq credentials from failing because a configured model slug was retired.
---

Groq model availability changes independently of credential validity. Treat a successful key check as necessary but not sufficient: defaults used by every resolver must also exist in Groq's live model catalog.

**Why:** A valid Groq key passed startup validation while dashboard requests failed with `MODEL_NOT_FOUND` because the configured default had been retired.

**How to apply:** Before accepting or releasing a Groq default-model change, compare both fast and powerful defaults with the provider's live `/openai/v1/models` response and run one authenticated dashboard AI request to a terminal event.

Deployment-wide drift alerts should remain separate from project events and be
deduplicated by the affected role/model fingerprint. Healthy or unconfigured
checks should resolve existing drift without opening a new alert.

**Why:** Startup provider validation has no project context, while operators
need durable visibility across restarts without credential or raw-response
retention.

**How to apply:** Keep alert payloads limited to provider, model role/ID,
safe remediation, and timestamps; only create alerts for confirmed catalog
missing results, not transient catalog-check failures.