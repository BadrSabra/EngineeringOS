/**
 * Bounded-concurrency in-process job queue.
 *
 * Scan and discovery jobs used to be pure fire-and-forget (`void
 * someHeavyJob(...)`) — nothing stopped an unbounded number of them from
 * running at once. A burst of scan/discovery requests could pile up enough
 * concurrent file-walks + rule-matching + graph-extraction work to starve
 * the same event loop that serves ordinary API requests.
 *
 * This queue caps both concurrent execution and in-memory pending work. When
 * the pending cap is full, named durable jobs are refused locally and remain
 * eligible in their database state for a later dispatcher pass. Callers still
 * enqueue fire-and-forget — a rejected/thrown job never escapes as an
 * unhandled rejection or wedges the queue behind it.
 *
 * PR-D1 (Durability hardening): Added `enqueueWithId` / `has` for ID-based
 * deduplication. All DB-backed jobs (scan, discovery, AI tasks) should use
 * `enqueueWithId` with their DB row ID so that periodic stale-pending sweeps
 * and crash-recovery re-enqueues cannot produce duplicate executions. The
 * advisory lock in each runner provides a second safety net if two closures
 * for the same job do race (e.g. one from reconciliation and one from a route
 * handler that runs before the advisory lock is held).
 */
import { logger } from "./logger.js";

type JobFn = () => Promise<void>;

export type EnqueueWithIdResult = "enqueued" | "duplicate" | "full";

interface QueueItem {
  /** DB row ID used for deduplication, or null for anonymous jobs. */
  id: string | null;
  fn: JobFn;
}

export class JobQueue {
  private readonly concurrency: number;
  private readonly maxPending: number;
  private running = 0;
  private readonly queue: QueueItem[] = [];
  private capacityWarningEmitted = false;

  /**
   * IDs of jobs currently waiting in the pending array (not yet dispatched
   * to execute). Cleared when the item is shifted off the queue.
   */
  private readonly pendingIds = new Set<string>();

  /**
   * IDs of jobs currently executing (between start and finally). Cleared
   * when the job's .finally() runs.
   */
  private readonly runningIds = new Set<string>();

  constructor(concurrency: number, maxPending = 20) {
    if (!Number.isInteger(concurrency) || concurrency < 1) {
      throw new Error(`JobQueue concurrency must be a positive integer, got ${concurrency}`);
    }
    if (!Number.isInteger(maxPending) || maxPending < 1) {
      throw new Error(`JobQueue maxPending must be a positive integer, got ${maxPending}`);
    }
    this.concurrency = concurrency;
    this.maxPending = maxPending;
  }

  /** Number of jobs currently executing (not waiting). */
  get activeCount(): number {
    return this.running;
  }

  /** Number of jobs waiting for a free slot. */
  get pendingCount(): number {
    return this.queue.length;
  }

  /** Remaining bounded waiting capacity; running jobs use separate slots. */
  get availablePendingCapacity(): number {
    return Math.max(0, this.maxPending - this.queue.length);
  }

  /**
   * PR-D1: Returns true if a job with this ID is already tracked — either
   * waiting in the pending array or actively executing. Use this before
   * calling `enqueueWithId` in contexts where you want to check without
   * the side effect of a no-op enqueue log.
   */
  has(id: string): boolean {
    return this.pendingIds.has(id) || this.runningIds.has(id);
  }

  /**
   * PR-H (H-1): Snapshot of current queue state.
   *
   * Boundary: this queue is process-local backpressure and dispatch only. It
   * is never the durable queue, and these counters must not be used to infer
   * global work or ownership across API instances. The DB row is written
   * first; the runner's conditional claim/lease is the cross-process
   * admission boundary.
   *
   * On restart, queued rows are redispatched from durable state. A row that
   * was already running is handled by job-reconciliation according to its job
   * class: scans may retry within their bounded retry policy, discovery is
   * made explicitly incomplete, and AI executions/tasks use their dedicated
   * reconciliation rules. There is no blanket "mark every in-flight job
   * failed" policy because unknown-midpoint side effects differ by class.
   *
   * The durable dispatcher periodically re-enqueues persisted pending rows
   * from every API instance. `enqueueWithId` removes duplicate closures within
   * this process only; the runner's DB claim/lease remains authoritative when
   * two instances observe the same row.
   */
  getStats(): { running: number; queued: number; concurrency: number } {
    return {
      running: this.running,
      queued: this.queue.length,
      concurrency: this.concurrency,
    };
  }

  /**
   * PR-D1: Enqueue a named job. If a job with the same `id` is already
   * pending or running, this is a no-op and returns `false` — preventing
   * double-execution when the stale-pending sweep or startup reconciliation
   * re-enqueues a job that is already in this queue. Returns `true` when the
   * job was successfully added. Use `enqueueWithIdDetailed` when the caller
   * needs to distinguish a duplicate from capacity backpressure.
   *
   * Use this for all DB-backed jobs (scan, discovery, AI tasks) where the
   * DB row ID is known. The advisory lock in each runner provides an
   * additional safety net for the multi-instance case.
   */
  enqueueWithIdDetailed(id: string, job: JobFn): EnqueueWithIdResult {
    if (this.has(id)) {
      logger.debug(
        { jobId: id },
        "job queue: skipping duplicate enqueue — job already tracked in this queue",
      );
      return "duplicate";
    }
    if (this.availablePendingCapacity === 0) {
      this.reportCapacityFull();
      return "full";
    }
    this.pendingIds.add(id);
    this.queue.push({ id, fn: job });
    this.drain();
    return "enqueued";
  }

  /**
   * Compatibility boolean for existing durable producers. `false` means the
   * row is already tracked or the local queue is full; durable callers must
   * leave their database row eligible for the next dispatch pass.
   */
  enqueueWithId(id: string, job: JobFn): boolean {
    return this.enqueueWithIdDetailed(id, job) === "enqueued";
  }

  /**
   * Enqueue an anonymous job (no deduplication). Fire-and-forget semantics:
   * resolves immediately, the job runs when a slot is free. Returns false
   * when the bounded waiting queue is full; anonymous jobs have no durable
   * row to redispatch, so callers must handle that result.
   *
   * Prefer `enqueueWithId` for any job that has a DB row ID. This method
   * is kept for backward compatibility and for genuinely one-off jobs with
   * no stable identifier.
   */
  enqueue(job: JobFn): boolean {
    if (this.availablePendingCapacity === 0) {
      this.reportCapacityFull();
      return false;
    }
    this.queue.push({ id: null, fn: job });
    this.drain();
    return true;
  }

  private reportCapacityFull(): void {
    if (this.capacityWarningEmitted) return;
    this.capacityWarningEmitted = true;
    logger.warn(
      {
        pendingCount: this.queue.length,
        maxPending: this.maxPending,
        activeCount: this.running,
      },
      "job queue: pending capacity reached; durable work remains eligible for redispatch",
    );
  }

  private drain(): void {
    while (this.running < this.concurrency && this.queue.length > 0) {
      const item = this.queue.shift();
      if (!item) break;
      this.capacityWarningEmitted = false;

      // Transition ID from pending → running tracking sets.
      if (item.id) {
        this.pendingIds.delete(item.id);
        this.runningIds.add(item.id);
      }

      this.running++;
      let slotReleased = false;
      const releaseSlot = () => {
        if (slotReleased) return;
        slotReleased = true;
        this.running--;
        this.drain();
      };

      let jobPromise: Promise<void>;
      try {
        jobPromise = Promise.resolve(item.fn());
      } catch (error) {
        jobPromise = Promise.reject(error);
      }

      void jobPromise.then(
        () => {
          if (item.id) this.runningIds.delete(item.id);
          releaseSlot();
        },
        (err) => {
          if (item.id) this.runningIds.delete(item.id);
          // Jobs are documented to handle their own errors internally, so
          // reaching here means a job broke that contract (missing top-level
          // try/catch). Log with queue depth for operational context so
          // on-call can tell whether this is an isolated failure or part of
          // a broader queue degradation.
          logger.error(
            { err, jobId: item.id, activeCount: this.running, pendingCount: this.queue.length },
            "job queue: job threw past its own error handling — ensure the job has a top-level try/catch",
          );
          releaseSlot();
        },
      );
    }
  }
}

// Scan and discovery jobs are both heavy, CPU/FS-bound pipelines that
// shouldn't run unbounded — they share one queue so a burst of either kind
// (or both at once) stays bounded by the same limit rather than each type
// separately allowing N, for a combined 2N.
export const heavyJobQueue = new JobQueue(2);
