---
name: Disposable PostgreSQL test isolation
description: Run database-writing integration tests without touching development or production rows.
---

Do not use an inherited `DATABASE_URL` for an integration test that inserts, updates, or deletes database rows, even when the suite is informally called a test-database suite. In this workspace, PostgreSQL binaries are available in the Nix store but are not on `PATH`, and `initdb` may need an explicit Unix-socket directory because `/run/postgresql` is absent.

**Why:** Database-backed tests can modify shared rows or trigger unrelated durable recovery work; a test label or test-looking project ID does not establish isolation. In this Replit shell, ending a ShellExec call can terminate the process group containing a `pg_ctl`-started postmaster, so a database that passed schema setup in one call may already be gone before tests in the next call.

**How to apply:** Create a unique PostgreSQL cluster under `/tmp`, bind TCP only to `127.0.0.1`, place its socket directory inside that temporary root, and pass an explicit local `DATABASE_URL` to schema setup and the test process. On this host, `initdb` under the `runner` account creates the `runner` role and `postgres` database by default; target that pair explicitly rather than assuming a database named `runner`. Unset inherited `PG*` connection variables, verify the URL plus server address, port, database name, and real data-directory path before DDL, then apply schema, run tests, and stop PostgreSQL within the same ShellExec call. Remove only the exact temporary root, and retain result logs elsewhere. If no local server is available, stop and establish a disposable database rather than falling back to Replit development or production.

In a SIGKILL recovery test, terminating a client during server-side `pg_sleep` or while it waits on a row lock does not immediately stop that PostgreSQL backend; it may notice the closed socket only after the blocking operation ends.

**Why:** A long sleep keeps its backend active, and a held row lock can keep a killed client's transaction waiting. Waiting for the session to disappear before releasing the test-owned lock can deadlock cleanup.

**How to apply:** Use a short bounded sleep for sleep-based tests. For row-lock tests, release the test-owned lock immediately after killing the client, then wait for the exact `application_name` session to disappear before recovery or cleanup.

## Child-process SIGKILL tests

Run a Vitest child with `--pool=threads` when the parent must kill the process executing a blocked test callback. Assign a unique PostgreSQL `application_name`, wait for that exact session to disappear after `SIGKILL`, and record disposable workspace paths so cleanup removes only roots owned by the test.

**Why:** Killing a forked test worker can leave its runner and database session alive, which weakens the process-death boundary and can race recovery or cleanup.

**How to apply:** Signal only after the durable checkpoint is visible, kill the child CLI process, drain its PostgreSQL session, then run reconciliation in a separate process against the same isolated database. Rebuild from durable state and remove only the captured temporary workspace.
