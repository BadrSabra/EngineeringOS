import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import {
  PreviewBuildInputUploadError,
  type PreviewBuildInputUploadAuthorization,
} from "./preview-build-upload.js";
import { createPreviewGatewayApp } from "./preview-gateway-server.js";

const uploadAuthorization: PreviewBuildInputUploadAuthorization = Object.freeze(
  {},
);

describe("Preview Gateway HTTP server", () => {
  it("serves a minimal health response without invoking AWS control", async () => {
    const handler = vi.fn(async () => Response.json({ action: "start" }));
    const app = createPreviewGatewayApp(handler);

    const response = await request(app).get("/healthz").expect(200);
    expect(response.body).toEqual({ status: "ok" });
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(handler).not.toHaveBeenCalled();
  });

  it("forwards only the bounded JSON control request to the signed-command handler", async () => {
    const handler = vi.fn(async (incoming: Request) => {
      expect(incoming.method).toBe("POST");
      expect(new URL(incoming.url).pathname).toBe(
        "/internal/v1/preview/commands",
      );
      expect(await incoming.json()).toEqual({ token: "signed-command" });
      return Response.json(
        { action: "stop", stopped: true },
        {
          status: 200,
          headers: {
            "cache-control": "no-store",
            "x-content-type-options": "nosniff",
          },
        },
      );
    });
    const app = createPreviewGatewayApp(handler);

    const response = await request(app)
      .post("/internal/v1/preview/commands")
      .set("Content-Type", "application/json")
      .send({ token: "signed-command" })
      .expect(200);

    expect(response.body).toEqual({ action: "stop", stopped: true });
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(handler).toHaveBeenCalledOnce();
  });

  it("forwards only the bounded JSON build request to the Builder handler", async () => {
    const builderHandler = vi.fn(async (incoming: Request) => {
      expect(incoming.method).toBe("POST");
      expect(new URL(incoming.url).pathname).toBe(
        "/internal/v1/preview/builds",
      );
      expect(await incoming.json()).toEqual({ token: "signed-build-job" });
      return Response.json({ jobId: "job-id" }, { status: 202 });
    });
    const app = createPreviewGatewayApp(
      async () => Response.json({ ok: true }),
      undefined,
      builderHandler,
    );
    const response = await request(app)
      .post("/internal/v1/preview/builds")
      .set("Content-Type", "application/json")
      .send({ token: "signed-build-job" })
      .expect(202);
    expect(response.body).toEqual({ jobId: "job-id" });
    expect(builderHandler).toHaveBeenCalledOnce();
  });

  it("forwards bounded reconcile commands only to the ECS observer handler", async () => {
    const reconcileHandler = vi.fn(async (incoming: Request) => {
      expect(new URL(incoming.url).pathname).toBe(
        "/internal/v1/preview/builds/reconcile",
      );
      expect(await incoming.json()).toEqual({ token: "signed-observation" });
      return Response.json({
        jobId: "job-id",
        buildId: "build-id",
        state: "running",
        taskArn:
          "arn:aws:ecs:eu-central-1:123456789012:task/preview/abcdef0123456789abcdef0123456789",
      });
    });
    const app = createPreviewGatewayApp(
      async () => Response.json({ ok: true }),
      undefined,
      undefined,
      reconcileHandler,
    );

    const response = await request(app)
      .post("/internal/v1/preview/builds/reconcile")
      .set("Content-Type", "application/json")
      .send({ token: "signed-observation" })
      .expect(200);
    expect(response.body.state).toBe("running");
    expect(reconcileHandler).toHaveBeenCalledOnce();
  });

  it("rejects invalid Builder request framing before invoking the handler", async () => {
    const builderHandler = vi.fn(async () => Response.json({ ok: true }));
    const app = createPreviewGatewayApp(
      async () => Response.json({ ok: true }),
      undefined,
      builderHandler,
    );
    await request(app)
      .post("/internal/v1/preview/builds")
      .set("Content-Type", "text/plain")
      .send("not-json")
      .expect(400);
    await request(app)
      .post("/internal/v1/preview/builds")
      .set("Content-Type", "application/json")
      .send({ token: "x".repeat(17_000) })
      .expect(413);
    expect(builderHandler).not.toHaveBeenCalled();
  });

  it("rejects wrong content types and oversized bodies before reaching the handler", async () => {
    const handler = vi.fn(async () => Response.json({ ok: true }));
    const app = createPreviewGatewayApp(handler);

    await request(app)
      .post("/internal/v1/preview/commands")
      .set("Content-Type", "text/plain")
      .send("not-json")
      .expect(400);
    await request(app)
      .post("/internal/v1/preview/commands")
      .set("Content-Type", "application/json")
      .send({ token: "x".repeat(9_000) })
      .expect(413);
    await request(app)
      .post("/internal/v1/preview/commands")
      .set("Content-Type", "application/json")
      .set("Content-Encoding", "gzip")
      .send(Buffer.from("compressed bodies are not accepted"))
      .expect(400);
    expect(handler).not.toHaveBeenCalled();
  });

  it("forwards only a bounded ZIP with a signed upload header to the artifact handler", async () => {
    const controlHandler = vi.fn(async () => Response.json({ ok: true }));
    const order: string[] = [];
    const buildInputUploadHandler = {
      authorize: vi.fn(() => {
        order.push("authorize");
        return uploadAuthorization;
      }),
      handle: vi.fn(async (incoming) => {
        order.push("handle");
        expect(incoming.contentType).toBe("application/zip");
        expect(incoming.token).toBe("signed-build-token");
        expect(incoming.archive).toEqual(Buffer.from("candidate archive"));
        return Response.json({ action: "build-input-upload" }, { status: 201 });
      }),
    };
    const app = createPreviewGatewayApp(
      controlHandler,
      buildInputUploadHandler,
    );

    const response = await request(app)
      .put("/internal/v1/preview/build-inputs")
      .set("Content-Type", "application/zip")
      .set("X-Preview-Build-Token", "signed-build-token")
      .send(Buffer.from("candidate archive"))
      .expect(201);

    expect(response.body).toEqual({ action: "build-input-upload" });
    expect(buildInputUploadHandler.authorize).toHaveBeenCalledOnce();
    expect(buildInputUploadHandler.handle).toHaveBeenCalledOnce();
    expect(order).toEqual(["authorize", "handle"]);
    expect(controlHandler).not.toHaveBeenCalled();
  });

  it("streams ZIP bytes to a stream-capable artifact handler without buffering them", async () => {
    let receivedBytes = Buffer.alloc(0);
    const buildInputUploadHandler = {
      supportsStreaming: true,
      authorize: vi.fn(() => uploadAuthorization),
      handle: vi.fn(async (incoming) => {
        expect(incoming.archive).toBeUndefined();
        expect(incoming.bytes).toBeDefined();
        const chunks: Buffer[] = [];
        for await (const chunk of incoming.bytes ?? []) {
          chunks.push(Buffer.from(chunk));
        }
        receivedBytes = Buffer.concat(chunks);
        return Response.json({ action: "streamed" }, { status: 201 });
      }),
    };
    const app = createPreviewGatewayApp(
      async () => Response.json({ ok: true }),
      buildInputUploadHandler,
    );
    const body = Buffer.from("streamed candidate archive");

    const response = await request(app)
      .put("/internal/v1/preview/build-inputs")
      .set("Content-Type", "application/zip")
      .set("X-Preview-Build-Token", "signed-build-token")
      .send(body)
      .expect(201);

    expect(response.body).toEqual({ action: "streamed" });
    expect(receivedBytes).toEqual(body);
    expect(buildInputUploadHandler.authorize).toHaveBeenCalledWith(
      "signed-build-token",
      body.byteLength,
    );
  });

  it("rejects uncompressed, unsigned, and unsupported uploads before storage", async () => {
    const buildInputUploadHandler = {
      authorize: vi.fn(() => uploadAuthorization),
      handle: vi.fn(async () => Response.json({ ok: true })),
    };
    const app = createPreviewGatewayApp(
      async () => Response.json({ ok: true }),
      buildInputUploadHandler,
    );

    await request(app)
      .put("/internal/v1/preview/build-inputs")
      .set("Content-Type", "application/zip")
      .set("X-Preview-Build-Token", "signed-build-token")
      .set("Content-Encoding", "gzip")
      .send(Buffer.from("archive"))
      .expect(400);
    await request(app)
      .put("/internal/v1/preview/build-inputs")
      .set("Content-Type", "application/zip")
      .send(Buffer.from("archive"))
      .expect(401);
    await request(app)
      .put("/internal/v1/preview/build-inputs")
      .set("Content-Type", "application/octet-stream")
      .set("X-Preview-Build-Token", "signed-build-token")
      .send(Buffer.from("archive"))
      .expect(400);

    expect(buildInputUploadHandler.handle).not.toHaveBeenCalled();
  });

  it("rejects invalid upload signatures before reading the archive body", async () => {
    const buildInputUploadHandler = {
      authorize: vi.fn(() => {
        throw new PreviewBuildInputUploadError(
          "PREVIEW_BUILD_UPLOAD_TOKEN_INVALID",
          401,
        );
      }),
      handle: vi.fn(async () => Response.json({ ok: true })),
    };
    const app = createPreviewGatewayApp(
      async () => Response.json({ ok: true }),
      buildInputUploadHandler,
    );

    await request(app)
      .put("/internal/v1/preview/build-inputs")
      .set("Content-Type", "application/zip")
      .set("X-Preview-Build-Token", "invalid-signature")
      .send(Buffer.from("candidate archive"))
      .expect(401);

    expect(buildInputUploadHandler.authorize).toHaveBeenCalledOnce();
    expect(buildInputUploadHandler.handle).not.toHaveBeenCalled();
  });

  it("forwards only bounded JSON to the Attestor route", async () => {
    const handler = vi.fn(async () =>
      Response.json(
        {
          jobId: "123e4567-e89b-42d3-a456-426614174000",
          buildId: "223e4567-e89b-42d3-a456-426614174001",
          state: "pending",
        },
        { status: 202 },
      ),
    );
    const app = createPreviewGatewayApp(
      async () => Response.json({ ok: true }),
      undefined,
      undefined,
      undefined,
      handler,
    );

    const response = await request(app)
      .post("/internal/v1/preview/builds/attest")
      .send({
        token: "signed-build-token",
        builderTaskArn:
          "arn:aws:ecs:eu-central-1:123456789012:task/preview/abcdef0123456789abcdef0123456789",
      })
      .expect(202);
    expect(response.body.state).toBe("pending");
    expect(handler).toHaveBeenCalledOnce();

    await request(app)
      .post("/internal/v1/preview/builds/attest")
      .set("Content-Type", "text/plain")
      .send("not-json")
      .expect(400);
    expect(handler).toHaveBeenCalledOnce();
  });

  it("rejects oversized Attestor messages before invoking the handler", async () => {
    const handler = vi.fn(async () => Response.json({ state: "pending" }));
    const app = createPreviewGatewayApp(
      async () => Response.json({ ok: true }),
      undefined,
      undefined,
      undefined,
      handler,
    );
    await request(app)
      .post("/internal/v1/preview/builds/attest")
      .send({ token: "x".repeat(17_000), builderTaskArn: "x" })
      .expect(413);
    expect(handler).not.toHaveBeenCalled();
  });

  it("does not expose arbitrary routes or method handling", async () => {
    const handler = vi.fn(async () => Response.json({ ok: true }));
    const app = createPreviewGatewayApp(handler);

    await request(app).get("/internal/v1/preview/commands").expect(404);
    await request(app).post("/unexpected").send({ token: "x" }).expect(404);
    expect(handler).not.toHaveBeenCalled();
  });
});
