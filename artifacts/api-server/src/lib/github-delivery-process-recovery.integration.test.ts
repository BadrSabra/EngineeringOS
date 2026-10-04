import { execFile, spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer as createHttpServer } from "node:http";
import { createConnection, createServer as createTcpServer } from "node:net";
import { promisify } from "node:util";
import path from "node:path";
import { tmpdir } from "node:os";
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  aiChangeProposalsTable,
  aiChatMessagesTable,
  aiChatSessionsTable,
  db,
  eventsTable,
  projectsTable,
} from "@workspace/db";
import { DELIVERY_TREE_DIGEST_VERSION, hashDeliveryTree } from "./delivery-workspace.js";

const execFileAsync = promisify(execFile);

async function git(rootPath: string, args: string[]) {
  return execFileAsync("git", ["-C", rootPath, ...args], { maxBuffer: 2_000_000 });
}

describe("E2 verified GitHub delivery process recovery", () => {
  it.runIf(process.env.RUN_E2_GITHUB_DELIVERY_PROCESS_RESTART === "1")(
    "shows full-index startup leaves a post-push/pre-receipt delivery unresolved, then reconciles one retry",
    async () => {
      const databaseUrl = process.env.DATABASE_URL;
      expect(databaseUrl).toBeTruthy();
      expect(new URL(databaseUrl!).hostname).toBe("127.0.0.1");

      const rootPath = await mkdtemp(path.join(tmpdir(), "engineeringos-github-process-"));
      const projectId = randomUUID();
      const sessionId = randomUUID();
      const messageId = randomUUID();
      const proposalId = randomUUID();
      const operationId = randomUUID();
      const apiChildren: Array<{
        child: ChildProcess;
        exit: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
        output: () => string;
        diagnostics: () => string;
        waitFor: (pattern: RegExp, label: string, timeoutMs?: number) => Promise<RegExpMatchArray>;
      }> = [];
      let fakeGithub: ReturnType<typeof createHttpServer> | undefined;
      const apiProblems: string[] = [];
      const remoteCounters = {
        blobCreates: 0,
        treeCreates: 0,
        commitCreates: 0,
        refUpdates: 0,
      };
      const deliveredCommits: string[] = [];
      let resolveHeldAfterState!: () => void;
      const heldAfterState = new Promise<void>((resolve) => {
        resolveHeldAfterState = resolve;
      });
      let holdFirstAfterStateRead = true;

      try {
        await git(rootPath, ["init", "-q"]);
        await writeFile(path.join(rootPath, "README.md"), "before\n");
        await git(rootPath, ["add", "README.md"]);
        await git(rootPath, [
          "-c", "user.name=Fixture", "-c", "user.email=fixture@example.com",
          "commit", "-qm", "initial",
        ]);
        const baseTreeHash = await hashDeliveryTree(rootPath);
        const parentHash = (await git(rootPath, ["rev-parse", "HEAD"])).stdout.trim();
        const parentTreeHash = (await git(rootPath, ["rev-parse", `${parentHash}^{tree}`])).stdout.trim();
        await writeFile(path.join(rootPath, "README.md"), "after\n");
        await git(rootPath, ["add", "README.md"]);
        await git(rootPath, [
          "-c", "user.name=Fixture", "-c", "user.email=fixture@example.com",
          "commit", "-qm", "verified local delivery",
        ]);
        const commitHash = (await git(rootPath, ["rev-parse", "HEAD"])).stdout.trim();
        const gitTreeHash = (await git(rootPath, ["rev-parse", `${commitHash}^{tree}`])).stdout.trim();
        const blobHash = (await git(rootPath, ["rev-parse", `${commitHash}:README.md`])).stdout.trim();
        const committedTreeHash = await hashDeliveryTree(rootPath);
        const now = new Date();

        await db.insert(projectsTable).values({
          id: projectId,
          ownerId: "e2-github-delivery-process-test",
          name: `github-process-${projectId.slice(0, 8)}`,
          rootPath,
          language: "typescript",
          status: "active",
          gitRemoteUrl: "https://github.com/example/project.git",
          gitDefaultBranch: "main",
          createdAt: now,
          updatedAt: now,
        });
        await db.insert(aiChatSessionsTable).values({
          id: sessionId,
          projectId,
          title: "E2 GitHub delivery process recovery",
          createdAt: now,
          updatedAt: now,
        });
        await db.insert(aiChatMessagesTable).values({
          id: messageId,
          sessionId,
          role: "assistant",
          content: "Verified delivery candidate",
          createdAt: now,
        });
        await db.insert(aiChangeProposalsTable).values({
          id: proposalId,
          projectId,
          sessionId,
          messageId,
          changes: JSON.stringify([{ path: "README.md", newContent: "after\n" }]),
          appliedChanges: JSON.stringify([{ path: "README.md", newContent: "after\n" }]),
          status: "applied",
          lifecycle: "committed",
          operationId,
          baseRevision: "e2-process-fixture",
          changeSetHash: "e2-process-change-set",
          baseTreeHash,
          candidateTreeHash: committedTreeHash,
          promotedTreeHash: committedTreeHash,
          treeDigestVersion: DELIVERY_TREE_DIGEST_VERSION,
          commitHash,
          committedTreeHash,
          createdAt: now,
          consumedAt: now,
        });
        await db.insert(eventsTable).values({
          id: randomUUID(),
          type: "GitCommitCreated",
          projectId,
          severity: "info",
          message: "Verified local commit created for E2 process recovery",
          correlationId: operationId,
          payload: {
            proposalId,
            operationId,
            commitHash,
            committedTreeHash,
            committedPaths: ["README.md"],
          },
        });

        let branch = {
          commitHash: parentHash,
          treeHash: parentTreeHash,
          message: "initial",
          parents: [] as string[],
        };
        let pendingMessage = "";
        fakeGithub = createHttpServer(async (req, res) => {
          const respond = (status: number, payload: Record<string, unknown>) => {
            res.writeHead(status, { "content-type": "application/json" });
            res.end(JSON.stringify(payload));
          };
          try {
            const chunks: Buffer[] = [];
            for await (const chunk of req) chunks.push(Buffer.from(chunk));
            const rawBody = Buffer.concat(chunks).toString("utf8");
            const body = rawBody ? JSON.parse(rawBody) as Record<string, unknown> : {};
            const requestPath = new URL(req.url ?? "/", "http://127.0.0.1").pathname;

            if (req.method === "GET" && requestPath.endsWith("/git/ref/heads/main")) {
              respond(200, { ref: "refs/heads/main", object: { sha: branch.commitHash } });
              return;
            }

            const commitMatch = requestPath.match(/\/git\/commits\/([^/]+)$/);
            if (req.method === "GET" && commitMatch) {
              const requestedHash = decodeURIComponent(commitMatch[1]!);
              if (requestedHash === parentHash) {
                respond(200, {
                  sha: parentHash,
                  tree: { sha: parentTreeHash },
                  message: "initial",
                  parents: [],
                });
                return;
              }
              if (requestedHash === commitHash && branch.commitHash === commitHash) {
                if (holdFirstAfterStateRead) {
                  // PATCH is acknowledged first; hold the immediate post-push
                  // read so SIGKILL lands before the service can write GitPushed.
                  holdFirstAfterStateRead = false;
                  resolveHeldAfterState();
                  return;
                }
                respond(200, {
                  sha: branch.commitHash,
                  tree: { sha: branch.treeHash },
                  message: branch.message,
                  parents: branch.parents.map((sha) => ({ sha })),
                });
                return;
              }
              respond(404, { message: `Unknown fixture commit ${requestedHash}` });
              return;
            }

            if (req.method === "POST" && requestPath.endsWith("/git/blobs")) {
              remoteCounters.blobCreates += 1;
              if (
                body.encoding !== "base64"
                || Buffer.from(String(body.content ?? ""), "base64").toString("utf8") !== "after\n"
              ) {
                apiProblems.push("Blob request did not contain the committed README bytes.");
                respond(422, { message: "Unexpected blob request" });
                return;
              }
              respond(201, { sha: blobHash });
              return;
            }

            if (req.method === "POST" && requestPath.endsWith("/git/trees")) {
              remoteCounters.treeCreates += 1;
              if (body.base_tree !== parentTreeHash) {
                apiProblems.push("Tree request did not use the verified parent tree.");
                respond(422, { message: "Unexpected base tree" });
                return;
              }
              respond(201, { sha: gitTreeHash });
              return;
            }

            if (req.method === "POST" && requestPath.endsWith("/git/commits")) {
              remoteCounters.commitCreates += 1;
              const parents = Array.isArray(body.parents) ? body.parents : [];
              if (body.tree !== gitTreeHash || parents.length !== 1 || parents[0] !== parentHash) {
                apiProblems.push("Commit request did not match the verified tree and parent.");
                respond(422, { message: "Unexpected commit request" });
                return;
              }
              pendingMessage = String(body.message ?? "");
              respond(201, { sha: commitHash });
              return;
            }

            if (req.method === "PATCH" && requestPath.endsWith("/git/refs/heads/main")) {
              if (
                branch.commitHash !== parentHash
                || body.sha !== commitHash
                || body.force !== false
                || !pendingMessage.includes(`EngineeringOS-Operation: ${operationId}`)
              ) {
                apiProblems.push("Ref update did not match the single verified delivery commit.");
                respond(409, { message: "Unexpected ref update" });
                return;
              }
              branch = {
                commitHash,
                treeHash: gitTreeHash,
                message: pendingMessage,
                parents: [parentHash],
              };
              remoteCounters.refUpdates += 1;
              deliveredCommits.push(commitHash);
              respond(200, { ref: "refs/heads/main", object: { sha: commitHash } });
              return;
            }

            apiProblems.push(`Unexpected fixture GitHub request: ${req.method} ${requestPath}`);
            respond(404, { message: "Unexpected fixture GitHub request" });
          } catch (error) {
            apiProblems.push(error instanceof Error ? error.message : String(error));
            respond(500, { message: "Fixture GitHub API failed" });
          }
        });
        await new Promise<void>((resolve, reject) => {
          fakeGithub!.once("error", reject);
          fakeGithub!.listen(0, "127.0.0.1", resolve);
        });
        const fixtureAddress = fakeGithub.address();
        if (!fixtureAddress || typeof fixtureAddress === "string") {
          throw new Error("Fixture GitHub API did not receive a TCP address.");
        }

        const deliveryServiceSource = [
          "(async () => {",
          '  const { executeVerifiedGitHubDelivery } = await import("./src/lib/github-delivery-service.ts");',
          "  let rawInput = '';",
          "  const inputPromise = new Promise((resolve) => {",
          "    process.stdin.setEncoding('utf8');",
          "    process.stdin.on('data', (chunk) => { rawInput += chunk; });",
          "    process.stdin.on('end', () => resolve(rawInput));",
          "  });",
          '  process.stdout.write("E2_GH_SERVICE_READY\\n");',
          "  const input = JSON.parse(await inputPromise);",
          "  const request = async (apiPath, init = {}) => {",
          "    const response = await fetch(process.env.E2_GITHUB_FIXTURE_URL + apiPath, {",
          "      method: init.method ?? 'GET',",
          "      headers: init.headers,",
          "      body: init.body,",
          "    });",
          "    const body = await response.json();",
          "    if (!response.ok) throw new Error(JSON.stringify(body));",
          "    return body;",
          "  };",
          "  const result = await executeVerifiedGitHubDelivery({ ...input, request });",
          '  process.stdout.write("E2_GH_RESULT:" + JSON.stringify(result) + "\\n", () => process.exit(0));',
          "})().catch((error) => {",
          "  console.error(error);",
          "  process.exitCode = 1;",
          "});",
        ].join("\n");
        const fullIndexSource = [
          "(async () => {",
          '  await import("./src/index.ts");',
          '  process.stdout.write("E2_FULL_INDEX_IMPORTED\\n");',
          "})().catch((error) => {",
          "  console.error(error);",
          "  process.exitCode = 1;",
          "});",
        ].join("\n");

        const startChild = async (
          source: string,
          applicationName: string,
          extraEnv: Record<string, string> = {},
        ) => {
          const childDatabaseUrl = new URL(databaseUrl!);
          childDatabaseUrl.searchParams.set("application_name", applicationName);
          const child = spawn(process.execPath, ["--import", "tsx", "-e", source], {
            cwd: process.cwd(),
            env: {
              DATABASE_URL: childDatabaseUrl.toString(),
              NODE_ENV: "test",
              PATH: process.env.PATH ?? "",
              PGAPPNAME: applicationName,
              AI_PROVIDER_EGRESS_DISABLED: "1",
              RUN_CONTROLLED_RELEASE_VALIDATION: "1",
              DASHBOARD_E2E_TEST_MODE: "fixture",
              ...extraEnv,
            },
            stdio: ["pipe", "pipe", "pipe"],
          });
          child.stdout?.setEncoding("utf8");
          child.stderr?.setEncoding("utf8");
          let output = "";
          let diagnostics = "";
          child.stdout?.on("data", (chunk: string) => {
            output += chunk;
          });
          child.stderr?.on("data", (chunk: string) => {
            diagnostics += chunk;
          });
          let spawnError: Error | undefined;
          child.once("error", (error) => {
            spawnError = error;
          });
          const exit = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
            child.once("exit", (code, signal) => resolve({ code, signal }));
          });
          const handle = {
            child,
            exit,
            output: () => output,
            diagnostics: () => diagnostics,
            waitFor: async (pattern: RegExp, label: string, timeoutMs = 30_000) => {
              const deadline = Date.now() + timeoutMs;
              while (Date.now() < deadline) {
                const match = output.match(pattern);
                if (match) return match;
                if (spawnError) throw spawnError;
                if (child.exitCode !== null || child.signalCode !== null) {
                  throw new Error(
                    `Child exited before ${label} (code=${child.exitCode}, signal=${child.signalCode}); `
                    + `stderr=${diagnostics}; stdout=${output}`,
                  );
                }
                await new Promise((resolve) => setTimeout(resolve, 25));
              }
              throw new Error(`Timed out waiting for ${label}; stderr=${diagnostics}; stdout=${output}`);
            },
          };
          apiChildren.push(handle);
          return handle;
        };
        const startDeliveryService = async (applicationName: string) => {
          const child = await startChild(deliveryServiceSource, applicationName, {
            E2_GITHUB_FIXTURE_URL: `http://127.0.0.1:${fixtureAddress.port}`,
          });
          await child.waitFor(/E2_GH_SERVICE_READY/, "delivery-service process readiness");
          return child;
        };
        const deliveryInput = {
          projectId,
          proposalId,
          operationId,
          rootPath,
          remoteUrl: "https://github.com/example/project.git",
          branch: "main",
          message: "EngineeringOS: main",
        };
        const waitUntil = async (
          label: string,
          predicate: () => Promise<boolean>,
          timeoutMs = 30_000,
        ) => {
          const deadline = Date.now() + timeoutMs;
          while (Date.now() < deadline) {
            if (await predicate()) return;
            await new Promise((resolve) => setTimeout(resolve, 25));
          }
          throw new Error(`Timed out waiting for ${label}.`);
        };

        const firstService = await startDeliveryService(`e2-gh-delivery-${projectId}-first`);
        firstService.child.stdin!.end(JSON.stringify(deliveryInput));
        await heldAfterState;
        expect(branch.commitHash).toBe(commitHash);
        expect(remoteCounters.refUpdates).toBe(1);

        expect(firstService.child.kill("SIGKILL")).toBe(true);
        expect(await firstService.exit).toMatchObject({ code: null, signal: "SIGKILL" });

        const loadDeliveryEvents = () => db
          .select({ type: eventsTable.type, payload: eventsTable.payload })
          .from(eventsTable)
          .where(and(
            eq(eventsTable.projectId, projectId),
            eq(eventsTable.correlationId, operationId),
          ));
        const afterCrashEvents = await loadDeliveryEvents();
        expect(branch).toMatchObject({
          commitHash,
          treeHash: gitTreeHash,
          parents: [parentHash],
        });
        expect(deliveredCommits).toEqual([commitHash]);
        expect(afterCrashEvents.filter((event) => event.type === "GitPushed")).toHaveLength(0);
        expect(afterCrashEvents.filter((event) => event.type === "GitPushRecoveryRequired")).toHaveLength(0);
        expect(apiProblems).toEqual([]);
        expect(remoteCounters).toEqual({
          blobCreates: 1,
          treeCreates: 1,
          commitCreates: 1,
          refUpdates: 1,
        });

        const portReservation = createTcpServer();
        await new Promise<void>((resolve, reject) => {
          portReservation.once("error", reject);
          portReservation.listen(0, "127.0.0.1", resolve);
        });
        const reservedAddress = portReservation.address();
        if (!reservedAddress || typeof reservedAddress === "string") {
          throw new Error("Could not reserve a port for full API startup.");
        }
        const indexPort = reservedAddress.port;
        await new Promise<void>((resolve, reject) => {
          portReservation.close((error) => error ? reject(error) : resolve());
        });
        const fullIndex = await startChild(fullIndexSource, `e2-gh-index-${projectId}`, {
          PORT: String(indexPort),
        });
        try {
          await fullIndex.waitFor(/E2_FULL_INDEX_IMPORTED/, "full src/index.ts import");
          await waitUntil("full API listener", async () => {
            if (fullIndex.child.exitCode !== null || fullIndex.child.signalCode !== null) {
              throw new Error(
                `Full API process exited before listening; stderr=${fullIndex.diagnostics()}; `
                + `stdout=${fullIndex.output()}`,
              );
            }
            return new Promise<boolean>((resolve) => {
              const socket = createConnection({ host: "127.0.0.1", port: indexPort });
              const finish = (connected: boolean) => {
                socket.destroy();
                resolve(connected);
              };
              socket.setTimeout(500, () => finish(false));
              socket.once("connect", () => finish(true));
              socket.once("error", () => finish(false));
            });
          }, 45_000);
          await new Promise((resolve) => setTimeout(resolve, 11_000));

          const afterStartupEvents = await loadDeliveryEvents();
          expect(branch.commitHash).toBe(commitHash);
          expect(deliveredCommits).toEqual([commitHash]);
          expect(afterStartupEvents.filter((event) => event.type === "GitPushed")).toHaveLength(0);
          expect(afterStartupEvents.filter((event) => event.type === "GitPushRecoveryRequired")).toHaveLength(0);
          expect(remoteCounters).toEqual({
            blobCreates: 1,
            treeCreates: 1,
            commitCreates: 1,
            refUpdates: 1,
          });
        } finally {
          if (fullIndex.child.exitCode === null && fullIndex.child.signalCode === null) {
            fullIndex.child.kill("SIGKILL");
          }
          await fullIndex.exit;
        }

        const retryService = await startDeliveryService(`e2-gh-delivery-${projectId}-retry`);
        retryService.child.stdin!.end(JSON.stringify(deliveryInput));
        const retryResult = JSON.parse(
          (await retryService.waitFor(/E2_GH_RESULT:(\{[^\r\n]*\})/, "fresh-process delivery reconciliation"))[1]!,
        ) as Record<string, unknown>;
        expect(await retryService.exit).toMatchObject({ code: 0, signal: null });
        expect(retryResult).toMatchObject({
          status: "passed",
          idempotent: true,
          remoteCommitHash: commitHash,
          remoteParentHash: parentHash,
          remoteTreeHash: gitTreeHash,
        });

        const duplicateService = await startDeliveryService(`e2-gh-delivery-${projectId}-duplicate`);
        duplicateService.child.stdin!.end(JSON.stringify(deliveryInput));
        const duplicateResult = JSON.parse(
          (await duplicateService.waitFor(/E2_GH_RESULT:(\{[^\r\n]*\})/, "duplicate delivery idempotency"))[1]!,
        ) as Record<string, unknown>;
        expect(await duplicateService.exit).toMatchObject({ code: 0, signal: null });
        expect(duplicateResult).toMatchObject({ status: "passed", idempotent: true });
        expect(remoteCounters).toEqual({
          blobCreates: 1,
          treeCreates: 1,
          commitCreates: 1,
          refUpdates: 1,
        });
        expect(deliveredCommits).toEqual([commitHash]);

        const finalEvents = await loadDeliveryEvents();
        const pushReceipts = finalEvents.filter((event) => event.type === "GitPushed");
        expect(pushReceipts).toHaveLength(1);
        expect(pushReceipts[0]?.payload).toMatchObject({
          proposalId,
          operationId,
          commitHash,
          remoteCommitHash: commitHash,
          remoteParentHash: parentHash,
          remoteTreeHash: gitTreeHash,
          operationMarker: `EngineeringOS-Operation: ${operationId}`,
        });
        expect(finalEvents.filter((event) => event.type === "GitPushRecoveryRequired")).toHaveLength(0);
        expect(apiProblems).toEqual([]);
      } finally {
        for (const handle of apiChildren) {
          if (handle.child.exitCode === null && handle.child.signalCode === null) {
            handle.child.kill("SIGKILL");
          }
        }
        await Promise.all(apiChildren.map((handle) => handle.exit));
        if (fakeGithub?.listening) {
          await new Promise<void>((resolve) => fakeGithub!.close(() => resolve()));
        }
        await db.delete(eventsTable).where(eq(eventsTable.projectId, projectId)).catch(() => undefined);
        await db.delete(aiChangeProposalsTable).where(eq(aiChangeProposalsTable.projectId, projectId)).catch(() => undefined);
        await db.delete(aiChatMessagesTable).where(eq(aiChatMessagesTable.sessionId, sessionId)).catch(() => undefined);
        await db.delete(aiChatSessionsTable).where(eq(aiChatSessionsTable.projectId, projectId)).catch(() => undefined);
        await db.delete(projectsTable).where(eq(projectsTable.id, projectId)).catch(() => undefined);
        await rm(rootPath, { recursive: true, force: true });
      }
    },
    180_000,
  );
});