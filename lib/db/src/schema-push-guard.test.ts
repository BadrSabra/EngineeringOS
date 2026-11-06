import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assertSafePostMergeSchemaPush } from "./schema-push-guard.js";

describe("post-merge schema push guard", () => {
  it("allows the expected existing primary key", async () => {
    await assertSafePostMergeSchemaPush({
      async query() {
        return { rows: [{ column_name: "credential_fingerprint" }] };
      },
    });
  });

  it("refuses a missing or changed primary key before schema push", async () => {
    for (const columns of [
      [],
      [{ column_name: "id" }],
      [{ column_name: "credential_fingerprint" }, { column_name: "id" }],
    ]) {
      await assert.rejects(
        () =>
          assertSafePostMergeSchemaPush({
            async query() {
              return { rows: columns };
            },
          }),
        /Refusing non-interactive schema push/,
      );
    }
  });
});
