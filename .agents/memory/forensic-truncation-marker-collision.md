---
name: Forensic truncation marker collision
description: Literal truncation-marker constants inside source files can be misclassified as evidence truncation.
---

Evidence completeness checks must distinguish a tool-appended truncation marker from the same marker text appearing as legitimate source code.

**Why:** A capability probe read the entire file-tools source successfully, but regex checks scanned the raw source body and matched the file's own marker constant, incorrectly changing coverage to PARTIAL and blocking a valid report.

**How to apply:** When detecting truncation, inspect the tool wrapper/metadata or strip known source literals before classification; never treat an arbitrary matching substring in source code as proof that the returned read was truncated.