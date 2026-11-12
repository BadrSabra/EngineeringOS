import {
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_RECEIPT_OBJECT_BYTES = 12_288;
const MAX_RECEIPT_TOKEN_LENGTH = 8_192;

export class PreviewBuildAttestorReceiptStoreError extends Error {
  constructor() {
    super("Preview Attestor receipt is unavailable.");
    this.name = "PreviewBuildAttestorReceiptStoreError";
  }
}

async function readBoundedBody(body: unknown): Promise<Buffer> {
  if (!body || typeof body !== "object" || !(Symbol.asyncIterator in body)) {
    throw new PreviewBuildAttestorReceiptStoreError();
  }
  const chunks: Buffer[] = [];
  let bytes = 0;
  try {
    for await (const chunk of body as AsyncIterable<Uint8Array>) {
      if (!(chunk instanceof Uint8Array)) {
        throw new PreviewBuildAttestorReceiptStoreError();
      }
      bytes += chunk.byteLength;
      if (bytes > MAX_RECEIPT_OBJECT_BYTES) {
        (body as { destroy?: () => void }).destroy?.();
        throw new PreviewBuildAttestorReceiptStoreError();
      }
      chunks.push(Buffer.from(chunk));
    }
  } catch {
    throw new PreviewBuildAttestorReceiptStoreError();
  }
  if (bytes < 1) throw new PreviewBuildAttestorReceiptStoreError();
  return Buffer.concat(chunks, bytes);
}

export function createS3PreviewBuildAttestorReceiptStore(input: {
  client: { send(command: unknown): Promise<unknown> };
  bucketName: string;
}) {
  const bucketName = input.bucketName.trim();
  if (
    !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucketName) ||
    bucketName.includes("..")
  ) {
    throw new PreviewBuildAttestorReceiptStoreError();
  }

  return {
    async read(inputValue: {
      jobId: string;
      buildId: string;
    }): Promise<string | null> {
      if (
        !UUID_PATTERN.test(inputValue.jobId) ||
        !UUID_PATTERN.test(inputValue.buildId)
      ) {
        throw new PreviewBuildAttestorReceiptStoreError();
      }
      const prefix = `preview-build-receipts/${inputValue.jobId}/`;
      let listing: {
        Contents?: Array<{ Key?: string }>;
        IsTruncated?: boolean;
      };
      try {
        listing = (await input.client.send(
          new ListObjectsV2Command({
            Bucket: bucketName,
            Prefix: prefix,
            MaxKeys: 2,
          }),
        )) as typeof listing;
      } catch {
        throw new PreviewBuildAttestorReceiptStoreError();
      }
      const objects = listing.Contents ?? [];
      if (listing.IsTruncated || objects.length > 1) {
        throw new PreviewBuildAttestorReceiptStoreError();
      }
      const key = objects[0]?.Key;
      if (!key) return null;
      const expectedPrefix = `${prefix}`;
      const receiptId = key.startsWith(expectedPrefix)
        ? key.slice(expectedPrefix.length).replace(/\.json$/, "")
        : "";
      if (
        !UUID_PATTERN.test(receiptId) ||
        key !== `${prefix}${receiptId}.json`
      ) {
        throw new PreviewBuildAttestorReceiptStoreError();
      }

      let head: {
        ContentLength?: number;
        ServerSideEncryption?: string;
      };
      try {
        head = (await input.client.send(
          new HeadObjectCommand({ Bucket: bucketName, Key: key }),
        )) as typeof head;
      } catch {
        throw new PreviewBuildAttestorReceiptStoreError();
      }
      if (
        !Number.isSafeInteger(head.ContentLength) ||
        (head.ContentLength ?? 0) < 1 ||
        (head.ContentLength ?? 0) > MAX_RECEIPT_OBJECT_BYTES ||
        head.ServerSideEncryption !== "AES256"
      ) {
        throw new PreviewBuildAttestorReceiptStoreError();
      }

      let response: { Body?: unknown };
      try {
        response = (await input.client.send(
          new GetObjectCommand({ Bucket: bucketName, Key: key }),
        )) as typeof response;
      } catch {
        throw new PreviewBuildAttestorReceiptStoreError();
      }
      const body = await readBoundedBody(response.Body);
      if (body.length !== head.ContentLength) {
        throw new PreviewBuildAttestorReceiptStoreError();
      }
      let record: unknown;
      try {
        record = JSON.parse(body.toString("utf8"));
      } catch {
        throw new PreviewBuildAttestorReceiptStoreError();
      }
      if (!record || typeof record !== "object" || Array.isArray(record)) {
        throw new PreviewBuildAttestorReceiptStoreError();
      }
      const value = record as Record<string, unknown>;
      if (
        Object.keys(value).length !== 4 ||
        value.jobId !== inputValue.jobId ||
        value.buildId !== inputValue.buildId ||
        value.receiptId !== receiptId ||
        typeof value.token !== "string" ||
        value.token.length < 1 ||
        value.token.length > MAX_RECEIPT_TOKEN_LENGTH ||
        !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value.token)
      ) {
        throw new PreviewBuildAttestorReceiptStoreError();
      }
      return value.token;
    },
  };
}
