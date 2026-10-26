import assert from "node:assert/strict";
import { after, test } from "node:test";
import net from "node:net";
import { startLocalLifecycleVite } from "./start-local-lifecycle-vite.mjs";

const originalEnvironment = new Map([
  "ENGINEERINGOS_LOCAL_E2E_AUTH_FIXTURE",
  "NODE_ENV",
  "RUN_CONTROLLED_RELEASE_VALIDATION",
  "ENGINEERING_AGENT_LIFECYCLE_E2E",
  "DASHBOARD_E2E_TEST_MODE",
  "PORT",
  "BASE_PATH",
  "CLERK_PUBLISHABLE_KEY",
  "API_PROXY_TARGET",
].map((key) => [key, process.env[key]]));

let viteServer;

function reserveLoopbackPort() {
  return new Promise((resolve, reject) => {
    const listener = net.createServer();
    listener.once("error", reject);
    listener.listen(0, "127.0.0.1", () => {
      const address = listener.address();
      if (!address || typeof address === "string") {
        listener.close();
        reject(new Error("Could not reserve a loopback test port."));
        return;
      }
      listener.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}

test("local lifecycle Vite binds its actual socket to loopback", async () => {
  const port = await reserveLoopbackPort();
  Object.assign(process.env, {
    ENGINEERINGOS_LOCAL_E2E_AUTH_FIXTURE: "1",
    NODE_ENV: "test",
    RUN_CONTROLLED_RELEASE_VALIDATION: "1",
    ENGINEERING_AGENT_LIFECYCLE_E2E: "1",
    DASHBOARD_E2E_TEST_MODE: "fixture",
    PORT: String(port),
    BASE_PATH: "/dashboard/",
    CLERK_PUBLISHABLE_KEY: "pk_test_local_lifecycle_fixture",
  });

  viteServer = await startLocalLifecycleVite({ port });
  const address = viteServer.httpServer?.address();
  assert.ok(address && typeof address !== "string");
  assert.equal(address.address, "127.0.0.1");
  assert.equal(address.port, port);

  const origin = `http://127.0.0.1:${port}`;
  const htmlResponse = await fetch(`${origin}/dashboard/`);
  assert.equal(htmlResponse.status, 200);
  const html = await htmlResponse.text();
  assert.doesNotMatch(html, /fonts\.(?:googleapis|gstatic)\.com/iu);
  assert.doesNotMatch(
    html,
    /<link\b(?=[^>]*\brel\s*=\s*["']?preconnect\b)[^>]*>/iu,
  );

  const cssResponse = await fetch(`${origin}/dashboard/src/index.css?direct`);
  assert.equal(cssResponse.status, 200);
  assert.match(cssResponse.headers.get("content-type") ?? "", /text\/css/iu);
  const css = await cssResponse.text();
  assert.doesNotMatch(css, /fonts\.(?:googleapis|gstatic)\.com/iu);
  assert.doesNotMatch(css, /@import\s+(?:url\()?["']?https?:\/\//iu);
  assert.match(css, /system-ui,\s*sans-serif/iu);
  assert.match(css, /ui-monospace,\s*SFMono-Regular/iu);
});

after(async () => {
  await viteServer?.close();
  for (const [key, value] of originalEnvironment) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});
