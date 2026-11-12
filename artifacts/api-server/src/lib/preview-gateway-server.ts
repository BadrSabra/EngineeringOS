import express, {
  type Express,
  type NextFunction,
  type Request as ExpressRequest,
  type Response as ExpressResponse,
} from "express";
import {
  MAX_PREVIEW_BUILD_ARCHIVE_BYTES,
  PreviewBuildInputUploadError,
  type PreviewBuildInputUploadAuthorization,
  type PreviewBuildInputUploadHandler,
  type PreviewBuildInputUploadRequest,
} from "./preview-build-upload.js";

const CONTROL_PATH = "/internal/v1/preview/commands";
const BUILD_PATH = "/internal/v1/preview/builds";
const BUILD_RECONCILE_PATH = "/internal/v1/preview/builds/reconcile";
const BUILD_ATTEST_PATH = "/internal/v1/preview/builds/attest";
const BUILD_INPUT_PATH = "/internal/v1/preview/build-inputs";
const MAX_BODY_BYTES = 8_192;
const MAX_BUILDER_BODY_BYTES = 16_384;
const MAX_BUILD_UPLOADS_IN_FLIGHT = 1;
const GENERIC_UNAVAILABLE = {
  error: "Preview control unavailable.",
};

function webRequest(request: ExpressRequest): Request {
  const headers = new Headers();
  const contentType = request.header("content-type");
  const contentLength = request.header("content-length");
  if (contentType) headers.set("content-type", contentType);
  if (contentLength) headers.set("content-length", contentLength);

  const body = Buffer.isBuffer(request.body)
    ? new Uint8Array(request.body)
    : undefined;
  return new Request(`http://preview-gateway.internal${request.originalUrl}`, {
    method: request.method,
    headers,
    ...(body ? { body } : {}),
  });
}

async function sendWebResponse(
  source: Promise<Response>,
  response: ExpressResponse,
): Promise<void> {
  const result = await source;
  result.headers.forEach((value, name) => response.setHeader(name, value));
  response.status(result.status);
  if (result.status === 204 || result.status === 304) {
    response.end();
    return;
  }
  response.send(Buffer.from(await result.arrayBuffer()));
}

function parserError(
  error: unknown,
  request: ExpressRequest,
  response: ExpressResponse,
  next: NextFunction,
): void {
  if (
    error &&
    typeof error === "object" &&
    "type" in error &&
    error.type === "entity.too.large"
  ) {
    response.status(413).json({
      error:
        request.path === BUILD_INPUT_PATH
          ? "Preview build upload is too large."
          : request.path === BUILD_PATH
            ? "Builder request is too large."
            : request.path === BUILD_ATTEST_PATH
              ? "Attestor request is too large."
              : "Control request is too large.",
    });
    return;
  }
  if (
    error &&
    typeof error === "object" &&
    "type" in error &&
    typeof error.type === "string" &&
    error.type.startsWith("encoding.")
  ) {
    response.status(400).json({ error: "Invalid control request." });
    return;
  }
  next(error);
}

export function createPreviewGatewayApp(
  controlHandler: (request: Request) => Promise<Response>,
  buildInputUploadHandler?: PreviewBuildInputUploadHandler,
  builderHandler?: (request: Request) => Promise<Response>,
  builderReconcileHandler?: (request: Request) => Promise<Response>,
  buildAttestorHandler?: (request: Request) => Promise<Response>,
): Express {
  const app = express();
  let activeBuildUploads = 0;
  app.disable("etag");
  app.disable("x-powered-by");
  app.set("trust proxy", false);
  app.get("/healthz", (_request, response) => {
    response
      .set("Cache-Control", "no-store")
      .set("X-Content-Type-Options", "nosniff")
      .status(200)
      .json({ status: "ok" });
  });
  if (buildInputUploadHandler) {
    app.put(
      BUILD_INPUT_PATH,
      (request, response, next) => {
        const contentType = request
          .header("content-type")
          ?.split(";", 1)[0]
          ?.trim()
          .toLowerCase();
        const contentLengthText = request.header("content-length");
        const contentLength = Number(contentLengthText);
        const token = request.header("x-preview-build-token");
        if (
          contentType !== "application/zip" ||
          request.header("content-encoding") ||
          request.header("transfer-encoding") ||
          !contentLengthText ||
          !/^\d+$/.test(contentLengthText) ||
          !Number.isSafeInteger(contentLength) ||
          contentLength < 1
        ) {
          response
            .set("Cache-Control", "no-store")
            .status(400)
            .json({ error: "Invalid Preview build upload." });
          return;
        }
        if (contentLength > MAX_PREVIEW_BUILD_ARCHIVE_BYTES) {
          response
            .set("Cache-Control", "no-store")
            .status(413)
            .json({ error: "Preview build upload is too large." });
          return;
        }
        if (!token || token.length > 8_192) {
          response
            .set("Cache-Control", "no-store")
            .status(401)
            .json({ error: "Preview build upload is invalid." });
          return;
        }
        let authorization: PreviewBuildInputUploadAuthorization;
        try {
          authorization = buildInputUploadHandler.authorize(
            token,
            contentLength,
          );
        } catch (error) {
          const status =
            error instanceof PreviewBuildInputUploadError ? error.status : 503;
          const code =
            error instanceof PreviewBuildInputUploadError
              ? error.code
              : "PREVIEW_BUILD_UPLOAD_UNAVAILABLE";
          response
            .set("Cache-Control", "no-store")
            .status(status)
            .json({ error: code });
          return;
        }
        if (activeBuildUploads >= MAX_BUILD_UPLOADS_IN_FLIGHT) {
          response
            .set("Retry-After", "2")
            .set("Cache-Control", "no-store")
            .status(429)
            .json({ error: "Preview build upload is busy." });
          return;
        }

        activeBuildUploads += 1;
        let released = false;
        const release = () => {
          if (released) return;
          released = true;
          activeBuildUploads -= 1;
        };
        response.once("close", () => {
          if (!response.locals.buildUploadHandlerStarted) release();
        });
        response.locals.releaseBuildUpload = release;
        response.locals.previewBuildAuthorization = authorization;
        response.locals.buildUploadHandlerStarted = false;
        next();
      },
      express.raw({
        type: "application/zip",
        limit: MAX_PREVIEW_BUILD_ARCHIVE_BYTES,
        inflate: false,
      }),
      (request, response, next) => {
        const contentLength = Number(request.header("content-length"));
        if (
          !Buffer.isBuffer(request.body) ||
          request.body.length !== contentLength
        ) {
          const release = response.locals.releaseBuildUpload as
            (() => void) | undefined;
          release?.();
          response
            .set("Cache-Control", "no-store")
            .status(400)
            .json({ error: "Invalid Preview build upload." });
          return;
        }
        const uploadRequest: PreviewBuildInputUploadRequest = {
          token: request.header("x-preview-build-token"),
          contentType: request
            .header("content-type")
            ?.split(";", 1)[0]
            ?.trim()
            .toLowerCase(),
          archive: request.body,
          authorization: response.locals
            .previewBuildAuthorization as PreviewBuildInputUploadAuthorization,
        };
        response.locals.buildUploadHandlerStarted = true;
        void sendWebResponse(
          buildInputUploadHandler.handle(uploadRequest),
          response,
        )
          .catch(next)
          .finally(() => {
            const release = response.locals.releaseBuildUpload as
              (() => void) | undefined;
            release?.();
          });
      },
    );
  }
  if (builderHandler) {
    app.post(
      BUILD_PATH,
      (request, response, next) => {
        const contentType = request
          .header("content-type")
          ?.split(";", 1)[0]
          ?.trim()
          .toLowerCase();
        const contentLength = Number(request.header("content-length"));
        if (contentType !== "application/json") {
          response.status(400).json({ error: "Invalid Builder request." });
          return;
        }
        if (
          Number.isFinite(contentLength) &&
          contentLength > MAX_BUILDER_BODY_BYTES
        ) {
          response.status(413).json({ error: "Builder request is too large." });
          return;
        }
        next();
      },
      express.raw({
        type: "application/json",
        limit: MAX_BUILDER_BODY_BYTES,
        inflate: false,
      }),
      (request, response, next) => {
        void sendWebResponse(
          builderHandler(webRequest(request)),
          response,
        ).catch(next);
      },
    );
  }
  if (builderReconcileHandler) {
    app.post(
      BUILD_RECONCILE_PATH,
      (request, response, next) => {
        const contentType = request
          .header("content-type")
          ?.split(";", 1)[0]
          ?.trim()
          .toLowerCase();
        const contentLength = Number(request.header("content-length"));
        if (contentType !== "application/json") {
          response
            .status(400)
            .json({ error: "Invalid Builder reconciliation request." });
          return;
        }
        if (
          Number.isFinite(contentLength) &&
          contentLength > MAX_BUILDER_BODY_BYTES
        ) {
          response.status(413).json({
            error: "Builder reconciliation request is too large.",
          });
          return;
        }
        next();
      },
      express.raw({
        type: "application/json",
        limit: MAX_BUILDER_BODY_BYTES,
        inflate: false,
      }),
      (request, response, next) => {
        void sendWebResponse(
          builderReconcileHandler(webRequest(request)),
          response,
        ).catch(next);
      },
    );
  }
  if (buildAttestorHandler) {
    app.post(
      BUILD_ATTEST_PATH,
      (request, response, next) => {
        const contentType = request
          .header("content-type")
          ?.split(";", 1)[0]
          ?.trim()
          .toLowerCase();
        const contentLength = Number(request.header("content-length"));
        if (contentType !== "application/json") {
          response.status(400).json({ error: "Invalid Attestor request." });
          return;
        }
        if (
          Number.isFinite(contentLength) &&
          contentLength > MAX_BUILDER_BODY_BYTES
        ) {
          response
            .status(413)
            .json({ error: "Attestor request is too large." });
          return;
        }
        next();
      },
      express.raw({
        type: "application/json",
        limit: MAX_BUILDER_BODY_BYTES,
        inflate: false,
      }),
      (request, response, next) => {
        void sendWebResponse(
          buildAttestorHandler(webRequest(request)),
          response,
        ).catch(next);
      },
    );
  }
  app.post(
    CONTROL_PATH,
    (request, response, next) => {
      const contentType = request
        .header("content-type")
        ?.split(";", 1)[0]
        ?.trim()
        .toLowerCase();
      const contentLength = Number(request.header("content-length"));
      if (contentType !== "application/json") {
        response.status(400).json({ error: "Invalid control request." });
        return;
      }
      if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
        response.status(413).json({ error: "Control request is too large." });
        return;
      }
      next();
    },
    express.raw({
      type: "application/json",
      limit: MAX_BODY_BYTES,
      inflate: false,
    }),
    (request, response, next) => {
      void sendWebResponse(controlHandler(webRequest(request)), response).catch(
        next,
      );
    },
  );
  app.use(parserError);
  app.use((_request, response) => {
    response
      .set("Cache-Control", "no-store")
      .set("X-Content-Type-Options", "nosniff")
      .status(404)
      .json({ error: "Not found." });
  });
  app.use(
    (
      _error: unknown,
      _request: ExpressRequest,
      response: ExpressResponse,
      _next: NextFunction,
    ) => {
      response
        .set("Cache-Control", "no-store")
        .set("X-Content-Type-Options", "nosniff")
        .status(503)
        .json(GENERIC_UNAVAILABLE);
    },
  );
  return app;
}
