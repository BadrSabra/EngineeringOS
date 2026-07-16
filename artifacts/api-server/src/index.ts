import app from "./app";
import { logger } from "./lib/logger";
import { getPort } from "./config";
import { reconcileStuckJobs } from "./lib/job-reconciliation";

const port = getPort();

// Reconcile any scan/discovery jobs orphaned by a previous process (crash,
// deploy, kill) before accepting traffic — see job-reconciliation.ts. This
// never throws, so a reconciliation bug can't block startup.
await reconcileStuckJobs();

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
});
