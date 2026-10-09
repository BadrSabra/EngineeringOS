import { and, lt, sql } from "drizzle-orm";
import { aiGeneralChatRateLimitsTable, db } from "@workspace/db";
import { logger } from "./logger.js";

export const GENERAL_CHAT_RATE_LIMIT = 20;
export const GENERAL_CHAT_RATE_WINDOW_MS = 60_000;

export async function checkGeneralChatRateLimit(
  ownerId: string,
  now = Date.now(),
): Promise<{ allowed: boolean; retryAfterSec?: number }> {
  const bucket = Math.floor(now / GENERAL_CHAT_RATE_WINDOW_MS);
  try {
    const [row] = await db
      .insert(aiGeneralChatRateLimitsTable)
      .values({
        ownerId,
        windowBucket: bucket,
        callCount: 1,
        updatedAt: new Date(now),
      })
      .onConflictDoUpdate({
        target: [
          aiGeneralChatRateLimitsTable.ownerId,
          aiGeneralChatRateLimitsTable.windowBucket,
        ],
        set: {
          callCount: sql`${aiGeneralChatRateLimitsTable.callCount} + 1`,
          updatedAt: new Date(now),
        },
      })
      .returning({ callCount: aiGeneralChatRateLimitsTable.callCount });

    if (!row) {
      logger.error(
        { ownerId, bucket },
        "General chat rate limiter returned no row; denying request",
      );
      return { allowed: false, retryAfterSec: 60 };
    }
    if (row.callCount > GENERAL_CHAT_RATE_LIMIT) {
      return {
        allowed: false,
        retryAfterSec: Math.ceil(
          (((bucket + 1) * GENERAL_CHAT_RATE_WINDOW_MS) - now) / 1_000,
        ),
      };
    }
    return { allowed: true };
  } catch (error) {
    logger.error(
      { error, ownerId, bucket },
      "General chat rate limiter failed; denying request",
    );
    return { allowed: false, retryAfterSec: 60 };
  }
}

setInterval(async () => {
  const cutoffBucket =
    Math.floor(Date.now() / GENERAL_CHAT_RATE_WINDOW_MS) - 2;
  try {
    await db
      .delete(aiGeneralChatRateLimitsTable)
      .where(
        and(
          lt(aiGeneralChatRateLimitsTable.windowBucket, cutoffBucket),
          lt(
            aiGeneralChatRateLimitsTable.updatedAt,
            new Date(Date.now() - GENERAL_CHAT_RATE_WINDOW_MS * 2),
          ),
        ),
      );
  } catch (error) {
    logger.warn({ error }, "General chat rate-limit cleanup failed");
  }
}, 60 * 60_000).unref();
