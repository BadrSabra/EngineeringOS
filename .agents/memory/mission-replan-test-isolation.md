---
name: Mission replan test isolation
description: Keep automatic replan tests from creating durable AI tasks or live provider work.
---

Test automatic Mission plan construction with an injected root-goal runner unless the test explicitly covers task dispatch. Do not use a module-wide mock of `mission-runtime` in shared worker contexts; it can affect unrelated runtime tests.

**Why:** Real `runMissionGoal` calls create durable task and execution rows. If fixture cleanup cannot remove the related project, startup recovery may retry the test-created task after an API restart.

**How to apply:** Inject a deterministic scheduled/waiting result for unit and coordinator tests; reserve real dispatch for isolated integration tests with explicit durable-row cleanup and recovery checks.