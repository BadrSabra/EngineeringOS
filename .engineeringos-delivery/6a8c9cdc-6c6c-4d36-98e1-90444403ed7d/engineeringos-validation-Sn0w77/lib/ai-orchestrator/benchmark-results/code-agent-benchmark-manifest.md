# Code Agent Benchmark Manifest

Suite: flight-deck-v1
Cases: 30

| Category | Cases |
| --- | ---: |
| single-file-edit | 4 |
| multi-file-change | 4 |
| test-failure-repair | 4 |
| typecheck-failure-repair | 4 |
| dependency-graph-change | 3 |
| conflict-recovery | 3 |
| broad-decomposition | 4 |
| safely-blocked | 4 |

| ID | Category | Expected terminal | Validation |
| --- | --- | --- | --- |
| single-file-001 | single-file-edit | READY_FOR_REVIEW | tests |
| single-file-002 | single-file-edit | READY_FOR_REVIEW | tests |
| single-file-003 | single-file-edit | READY_FOR_REVIEW | tests |
| single-file-004 | single-file-edit | READY_FOR_REVIEW | tests-and-typecheck |
| multi-file-001 | multi-file-change | READY_FOR_REVIEW | tests-and-typecheck |
| multi-file-002 | multi-file-change | READY_FOR_REVIEW | tests |
| multi-file-003 | multi-file-change | READY_FOR_REVIEW | tests-and-typecheck |
| multi-file-004 | multi-file-change | READY_FOR_REVIEW | tests-and-typecheck |
| test-failure-001 | test-failure-repair | READY_FOR_REVIEW | tests |
| test-failure-002 | test-failure-repair | READY_FOR_REVIEW | tests |
| test-failure-003 | test-failure-repair | READY_FOR_REVIEW | tests |
| test-failure-004 | test-failure-repair | BLOCKED | tests |
| typecheck-failure-001 | typecheck-failure-repair | READY_FOR_REVIEW | typecheck |
| typecheck-failure-002 | typecheck-failure-repair | READY_FOR_REVIEW | typecheck |
| typecheck-failure-003 | typecheck-failure-repair | READY_FOR_REVIEW | typecheck |
| typecheck-failure-004 | typecheck-failure-repair | BLOCKED | unavailable |
| dependency-graph-001 | dependency-graph-change | READY_FOR_REVIEW | tests-and-typecheck |
| dependency-graph-002 | dependency-graph-change | READY_FOR_REVIEW | typecheck |
| dependency-graph-003 | dependency-graph-change | BLOCKED | unavailable |
| conflict-001 | conflict-recovery | READY_FOR_REVIEW | tests |
| conflict-002 | conflict-recovery | BLOCKED | unavailable |
| conflict-003 | conflict-recovery | BLOCKED | unavailable |
| broad-001 | broad-decomposition | READY_FOR_REVIEW | tests-and-typecheck |
| broad-002 | broad-decomposition | READY_FOR_REVIEW | typecheck |
| broad-003 | broad-decomposition | BLOCKED | unavailable |
| broad-004 | broad-decomposition | READY_FOR_REVIEW | tests-and-typecheck |
| blocked-001 | safely-blocked | BLOCKED | unavailable |
| blocked-002 | safely-blocked | BLOCKED | unavailable |
| blocked-003 | safely-blocked | BLOCKED | unavailable |
| blocked-004 | safely-blocked | BLOCKED | unavailable |
