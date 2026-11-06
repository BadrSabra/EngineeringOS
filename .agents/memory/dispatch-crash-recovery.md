---
name: Dispatch recovery after Mission completion
description: Contract for recording a plan dispatch when the API crashed after the run finished.
---
Dispatch recovery accepts a `completed` Mission only when every root Goal is completed and has exactly one completed Execution; it records that Execution and never calls the runner. Anything ambiguous or non-completed fails closed.

**Why:** a single-goal plan can finish and complete the Mission before DISPATCHED is written; requiring an active Mission left the outcome never evaluated.

**How to apply:** keep both the plan lookup and the recording transaction in agreement on this rule. Failed-run crash windows (Mission left in needs_replan) are not covered.
