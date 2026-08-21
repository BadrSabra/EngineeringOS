import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  // Keep Vitest anchored to this artifact. A historical copy can exist under
  // .engineeringos-projects, but it must never become a second test root.
  root: fileURLToPath(new URL(".", import.meta.url)),
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    testTimeout: 20000,
    fileParallelism: false,
    maxWorkers: 1,
    minWorkers: 1,
  },
});
