---
name: GitHub pull-request file filtering
description: GitHub pull-request changed_files is a count, so job-level path gating needs an action or equivalent API-backed changed-path filter.
---

Use an API-backed changed-path filter such as dorny/paths-filter when a workflow job must conditionally run for specific pull-request files; `github.event.pull_request.changed_files` is numeric metadata, not the file list.

**Why:** Treating the count as a string silently skips contract checks for pull requests whose changed files should activate them.

**How to apply:** Keep the filter patterns synchronized with the checked-in trigger policy and gate dependent jobs on the filter job's string output.