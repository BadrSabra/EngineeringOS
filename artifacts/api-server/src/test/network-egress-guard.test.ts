import { createServer } from "node:http";
import { afterEach, expect, it } from "vitest";

let server: ReturnType<typeof createServer> | undefined;

afterEach(async () => {
  if (!server) return;
  const activeServer = server;
  server = undefined;
  await new Promise<void>((resolve, reject) => {
    activeServer.close((error) => error ? reject(error) : resolve());
  });
});

it("blocks external fetches while allowing loopback test services", async () => {
  await expect(fetch("https://openrouter.ai/api/v1/chat/completions"))
    .rejects.toThrow("Blocked external fetch from API tests.");

  server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/plain" });
    response.end("local fixture");
  });
  await new Promise<void>((resolve, reject) => {
    server!.once("error", reject);
    server!.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server did not bind.");
  await expect(fetch(`http://127.0.0.1:${address.port}/`))
    .resolves.toMatchObject({ status: 200 });
});
