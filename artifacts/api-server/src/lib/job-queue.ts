/**
 * Bounded-concurrency in-process job queue.
 *
 * Scan and discovery jobs used to be pure fire-and-forget (`void
 * someHeavyJob(...)`) — nothing stopped an unbounded number of them from
 * running at once. A burst of scan/discovery requests could pile up enough
 * concurrent file-walks + rule-matching + graph-extraction work to starve
 * the same event loop that serves ordinary API requests.
 *
 * This queue caps how many jobs actually execute concurrently. Anything
 * beyond the concurrency limit waits in-memory (cheap: each queued item is
 * just a closure) until a running slot frees up. Callers still enqueue
 * fire-and-forget — the queue itself guarantees a rejected/thrown job never
 * escapes as an unhandled rejection, so a bug in one job can't crash the
 * process or wedge the queue for jobs behind it.
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

interface QueueItem {
  /** DB row ID used for deduplication, or null for anonymous jobs. */
  id: string | null;
  fn: JobFn;
}

export class JobQueue {
  private readonly concurrency: number;
  private running = 0;
  private readonly queue: QueueItem[] = [];

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

  constructor(concurrency: number) {
    if (!Number.isInteger(concurrency) || concurrency < 1) {
      throw new Error(`JobQueue concurrency must be a positive integer, got ${concurrency}`);
    }
    this.concurrency = concurrency;
  }

  /** Number of jobs currently executing (not waiting). */
  get activeCount(): number {
    return this.running;
  }

  /** Number of jobs waiting for a free slot. */
  get pendingCount(): number {
    return this.queue.length;
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
   * Durability: this queue is in-process only. Jobs actively executing at
   * restart time (`running` / `discovering`) are marked failed by the
   * job-reconciliation module — they cannot be safely resumed from an unknown
   * midpoint. Jobs waiting for a free slot (`queued` / `pending`) are
   * automatically re-enqueued by job-reconciliation at next startup: all
   * parameters needed to re-run them are persisted to DB rows before they
   * reach this queue, so no pending work is silently lost across restarts.
   *
   * PR-D1: The stale-pending sweep in job-reconciliation also periodically
   * re-enqueues any "queued" DB rows whose in-memory closure may have been
   * lost without a clean restart. `enqueueWithId` deduplicates so that sweep
   * cannot cause double-execution of jobs still in this queue.
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
   * job was successfully added.
   *
   * Use this for all DB-backed jobs (scan, discovery, AI tasks) where the
   * DB row ID is known. The advisory lock in each runner provides an
   * additional safety net for the multi-instance case.
   */
  enqueueWithId(id: string, job: JobFn): boolean {
    if (this.has(id)) {
      logger.debug(
        { jobId: id },
        "job queue: skipping duplicate enqueue — job already tracked in this queue",
      );
      return false;
    }
    if (this.queue.length >= 20) {
      logger.warn(
        { pendingCount: this.queue.length, activeCount: this.running },
        "job queue: high pending depth — downstream processing may be falling behind",
      );
    }
    this.pendingIds.add(id);
    this.queue.push({ id, fn: job });
    this.drain();
    return true;
  }

  /**
   * Enqueue an anonymous job (no deduplication). Fire-and-forget semantics:
   * resolves immediately, the job runs when a slot is free.
   *
   * Prefer `enqueueWithId` for any job that has a DB row ID. This method
   * is kept for backward compatibility and for genuinely one-off jobs with
   * no stable identifier.
   */
  enqueue(job: JobFn): void {
    if (this.queue.length >= 20) {
      // Warn when the backlog is deep — this is a backpressure signal that
      // the queue is accepting work faster than it can drain it. Callers
      // should not shed this work silently; the log gives operators a chance
      // to react (scale up, add concurrency, or inspect stuck jobs).
      logger.warn(
        { pendingCount: this.queue.length, activeCount: this.running },
        "job queue: high pending depth — downstream processing may be falling behind",
      );
    }
    this.queue.push({ id: null, fn: job });
    this.drain();
  }

  private drain(): void {
    while (this.running < this.concurrency && this.queue.length > 0) {
      const item = this.queue.shift();
      if (!item) break;

      // Transition ID from pending → running tracking sets.
      if (item.id) {
        this.pendingIds.delete(item.id);
        this.runningIds.add(item.id);
      }

      this.running++;
      item.fn()
        .catch((err) => {
          // Jobs are documented to handle their own errors internally, so
          // reaching here means a job broke that contract (missing top-level
          // try/catch). Log with queue depth for operational context so
          // on-call can tell whether this is an isolated failure or part of
          // a broader queue degradation.
          logger.error(
            { err, jobId: item.id, activeCount: this.running, pendingCount: this.queue.length },
            "job queue: job threw past its own error handling — ensure the job has a top-level try/catch",
          );
        })
        .finally(() => {
          if (item.id) this.runningIds.delete(item.id);
          this.running--;
          this.drain();
        });
    }
  }
}

// Scan and discovery jobs are both heavy, CPU/FS-bound pipelines that
// shouldn't run unbounded — they share one queue so a burst of either kind
// (or both at once) stays bounded by the same limit rather than each type
// separately allowing N, for a combined 2N.
export const heavyJobQueue = new JobQueue(2);
