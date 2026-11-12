import { sql, type SQL } from "drizzle-orm";

const PREVIEW_ARTIFACT_LOCK_NAMESPACE = "engineeringos-preview-artifact-v1";
const DIGEST_PATTERN = /^[a-f0-9]{64}$/i;

export async function lockPreviewArtifactDigest(
  tx: { execute(query: SQL): Promise<unknown> },
  digest: string,
): Promise<void> {
  if (!DIGEST_PATTERN.test(digest)) {
    throw new Error("Preview artifact digest is invalid.");
  }
  await tx.execute(sql`
    SELECT pg_advisory_xact_lock(
      hashtextextended(
        ${`${PREVIEW_ARTIFACT_LOCK_NAMESPACE}:${digest.toLowerCase()}`},
        0
      )
    )
  `);
}
