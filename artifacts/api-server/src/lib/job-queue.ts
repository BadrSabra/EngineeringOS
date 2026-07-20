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
 */
import { logger } from "./logger.js";

type JobFn = () => Promise<void>;

export class JobQueue {
  private readonly concurrency: number;
  private running = 0;
  private readonly pending: JobFn[] = [];

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
    return this.pending.length;
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
   */
  getStats(): { running: number; queued: number; concurrency: number } {
    return {
      running: this.running,
      queued: this.pending.length,
      concurrency: this.concurrency,
    };
  }

  /**
   * Enqueue a job. Resolves immediately (fire-and-forget semantics) —
   * this is intentionally not awaited by callers, matching the existing
   * pattern where the HTTP response doesn't wait on job completion. Each
   * job function is expected to handle its own errors and persist its own
   * outcome (as scan-runner.ts and discovery.ts already do); this queue's
   * job is purely concurrency control, not error handling on their behalf.
   */
  enqueue(job: JobFn): void {
    if (this.pending.length >= 20) {
      // Warn when the backlog is deep — this is a backpressure signal that
      // the queue is accepting work faster than it can drain it. Callers
      // should not shed this work silently; the log gives operators a chance
      // to react (scale up, add concurrency, or inspect stuck jobs).
      logger.warn(
        { pendingCount: this.pending.length, activeCount: this.running },
        "job queue: high pending depth — downstream processing may be falling behind",
      );
    }
    this.pending.push(job);
    this.drain();
  }

  private drain(): void {
    while (this.running < this.concurrency && this.pending.length > 0) {
      const job = this.pending.shift();
      if (!job) break;
      this.running++;
      job()
        .catch((err) => {
          // Jobs are documented to handle their own errors internally, so
          // reaching here means a job broke that contract (missing top-level
          // try/catch). Log with queue depth for operational context so
          // on-call can tell whether this is an isolated failure or part of
          // a broader queue degradation.
          logger.error(
            { err, activeCount: this.running, pendingCount: this.pending.length },
            "job queue: job threw past its own error handling — ensure the job has a top-level try/catch",
          );
        })
        .finally(() => {
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
