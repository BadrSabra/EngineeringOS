---
name: Forensic Recovery formatting tolerance
description: Safe tolerance rules for provider-generated Recovery reports.
---

Forensic Recovery may tolerate harmless presentation differences in the six section headings, including numbering style, omitted numbering, trailing colons, and simple bold/italic Markdown.

**Why:** Providers occasionally return a semantically complete six-section report with minor heading formatting differences, causing a parse failure even though the report can still be checked safely.

**How to apply:** Normalize only the headings and require all six exact section names in order. Always run the normalized report through the existing contract and source-evidence gates; never relax source matching, coverage, Finding fields, repair linkage, or verdict rules.