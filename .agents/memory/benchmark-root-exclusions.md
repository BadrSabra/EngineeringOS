---
name: Benchmark root exclusions
description: Keep disposable benchmark roots limited to source files and away from unrelated operational state.
---

Benchmark disposable roots should omit operational directories that are excluded from candidate digests. Copying unrelated workspace state makes runtime depend on the size of those directories and can expose prior artifacts to fixture execution.

**Why:** On October 1, 2026, a live benchmark root copy stalled before provider work because `.engineeringos-delivery` contained about 2.2 GB, although the candidate digest intentionally excluded it.

**How to apply:** Keep the benchmark copy exclusions aligned with the delivery digest exclusions. Before copying another top-level directory, confirm it is source required by validation and included in the candidate's integrity contract.