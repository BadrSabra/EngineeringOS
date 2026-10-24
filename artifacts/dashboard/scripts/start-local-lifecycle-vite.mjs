import { createServer } from "vite";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const requiredFixtureEnvironment = {
  ENGINEERINGOS_LOCAL_E2E_AUTH_FIXTURE: "1",
  NODE_ENV: "test",
  RUN_CONTROLLED_RELEASE_VALIDATION: "1",
  ENGINEERING_AGENT_LIFECYCLE_E2E: "1",
  DASHBOARD_E2E_TEST_MODE: "fixture",
};

function assertLocalFixtureEnvironment(env = process.env) {
  for (const [key, expected] of Object.entries(requiredFixtureEnvironment)) {
    if (env[key] !== expected) {
      throw new Error(
        `Local lifecycle Vite requires ${key}=${expected}.`,
      );
    }
  }
}

export async function startLocalLifecycleVite({
  port = Number(process.env.PORT),
  env = process.env,
} = {}) {
  assertLocalFixtureEnvironment(env);
  if (!Number.isInteger(port) || port <= 0 || port > 65_535) {
    throw new Error("Local lifecycle Vite requires a valid non-zero PORT.");
  }

  const server = await createServer({
    configFile: fileURLToPath(new URL("../vite.config.ts", import.meta.url)),
    server: {
      host: "127.0.0.1",
      port,
      strictPort: true,
    },
  });

  try {
    await server.listen();
    const address = server.httpServer?.address();
    if (
      !address
      || typeof address === "string"
      || address.address !== "127.0.0.1"
      || address.port !== port
    ) {
      throw new Error(
        `Local lifecycle Vite bound to an unexpected address: ${JSON.stringify(address)}.`,
      );
    }
    return server;
  } catch (error) {
    await server.close().catch(() => undefined);
    throw error;
  }
}

if (
  process.argv[1]
  && import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const server = await startLocalLifecycleVite();
  const address = server.httpServer?.address();
  console.log(`Local lifecycle Vite listening at ${JSON.stringify(address)}.`);

  let closing = false;
  const close = async () => {
    if (closing) return;
    closing = true;
    await server.close();
    process.exit(0);
  };
  process.once("SIGINT", close);
  process.once("SIGTERM", close);
}
