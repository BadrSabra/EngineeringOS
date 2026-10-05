---
name: Disposable PostgreSQL test isolation
description: Run database-writing integration tests without touching development or production rows.
---

Do not use an inherited `DATABASE_URL` for an integration test that inserts, updates, or deletes database rows, even when the suite is informally called a test-database suite. In this workspace, PostgreSQL binaries are available in the Nix store but are not on `PATH`, and `initdb` may need an explicit Unix-socket directory because `/run/postgresql` is absent.

**Why:** Database-backed tests can modify shared rows or trigger unrelated durable recovery work; a test label or test-looking project ID does not establish isolation. In this Replit shell, a PostgreSQL daemon started by a foreground shell command may be gone when that command returns.

**How to apply:** Create a unique PostgreSQL cluster under `/tmp`, bind TCP only to `127.0.0.1`, place its socket directory inside that temporary root, and pass an explicit local `DATABASE_URL` to schema setup and the test process. Unset inherited `PG*` connection variables, apply the current schema only to that cluster, run the narrow intended test, then stop PostgreSQL and remove only the exact temporary root. Keep PostgreSQL alive in a managed background shell task across tool calls; stop it before cleanup. If no local server is available, stop and establish a disposable database rather than falling back to Replit development or production.

In a SIGKILL recovery test, terminating the client during a server-side `pg_sleep` does not immediately stop that PostgreSQL backend; it may notice the closed socket only after the sleep finishes.

**Why:** A long sleep can hold the transaction and block the test's cleanup long after the client process has been killed.

**How to apply:** Use a short bounded sleep to expose the in-flight transaction, kill the client, then wait for that exact `application_name` session to disappear before restarting recovery or dropping the test trigger.
