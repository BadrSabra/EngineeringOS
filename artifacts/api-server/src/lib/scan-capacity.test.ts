import { randomInt } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  acquireGlobalScanSlot,
  GLOBAL_SCAN_CONCURRENCY,
} from "./scan-capacity.js";

describe("global scan capacity", () => {
  it("admits only the configured number of independent PostgreSQL sessions", async () => {
    const testNamespace = randomInt(1_500_000_000, 2_000_000_000);
    const held: Awaited<ReturnType<typeof acquireGlobalScanSlot>>[] = [];

    try {
      const attempts = await Promise.all(
        Array.from(
          { length: GLOBAL_SCAN_CONCURRENCY + 1 },
          () => acquireGlobalScanSlot(testNamespace),
        ),
      );
      const acquired = attempts.filter(
        (lock): lock is NonNullable<typeof lock> => lock !== undefined,
      );
      held.push(...acquired);

      expect(acquired).toHaveLength(GLOBAL_SCAN_CONCURRENCY);
      expect(attempts.filter((lock) => lock === undefined)).toHaveLength(1);

      const released = held.shift();
      await released?.release();
      const replacement = await acquireGlobalScanSlot(testNamespace);
      expect(replacement).toBeDefined();
      if (replacement) held.push(replacement);
    } finally {
      await Promise.all(
        held.flatMap((lock) => lock ? [lock.release()] : []),
      );
    }
  });
});
