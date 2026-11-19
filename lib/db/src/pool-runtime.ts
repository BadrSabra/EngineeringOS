export const DEFAULT_DATABASE_POOL_MAX = 10;

type PoolErrorSource = {
  on(event: "error", listener: (error: Error) => void): unknown;
};

export type DatabasePoolErrorDetails = {
  errorName: string;
  errorCode?: string;
};

export type DatabasePoolErrorReporter = (
  message: string,
  details: DatabasePoolErrorDetails,
) => void;

export type DatabasePoolMetrics = {
  activeClients: number;
  idleClients: number;
  waitingRequests: number;
  maxClients: number;
};

export type DatabasePoolMetricsSource = {
  totalCount: number;
  idleCount: number;
  waitingCount: number;
};

export function readDatabasePoolMetrics(
  pool: DatabasePoolMetricsSource,
  maxClients: number,
): DatabasePoolMetrics {
  return {
    activeClients: pool.totalCount - pool.idleCount,
    idleClients: pool.idleCount,
    waitingRequests: pool.waitingCount,
    maxClients,
  };
}

/**
 * pg-pool currently defaults to ten clients. Keep that behavior unless the
 * deployment explicitly sets its per-process connection budget.
 */
export function parseDatabasePoolMax(value: string | undefined): number {
  if (value === undefined) return DEFAULT_DATABASE_POOL_MAX;
  if (!/^[1-9]\d*$/.test(value)) {
    throw new Error("DATABASE_POOL_MAX must be a positive integer.");
  }

  const max = Number(value);
  if (!Number.isSafeInteger(max)) {
    throw new Error("DATABASE_POOL_MAX must be a positive integer.");
  }
  return max;
}

/**
 * node-postgres emits idle client errors on the pool. A listener prevents an
 * otherwise unhandled EventEmitter error from terminating the process.
 */
export function attachDatabasePoolErrorHandler(
  pool: PoolErrorSource,
  report: DatabasePoolErrorReporter = (message, details) => {
    console.error(message, details);
  },
): void {
  pool.on("error", (error) => {
    const errorCode = (error as NodeJS.ErrnoException).code;
    report("Database pool idle client error", {
      errorName: error.name || "Error",
      ...(typeof errorCode === "string" ? { errorCode } : {}),
    });
  });
}
