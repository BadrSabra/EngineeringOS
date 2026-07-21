import { describe, expect, it } from "vitest";
import { JobQueue } from "./job-queue.js";

/** Resolves after `ms` milliseconds. */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * A job's own body resolving (used by tests to know "the work happened")
 * races the queue's bookkeeping (`running--` + `drain()`), which only runs
 * in the `.finally()` attached *after* the job promise settles. Poll until
 * the queue reports idle rather than assuming it's synchronous with the
 * job's own resolution.
 */
async function waitUntilIdle(queue: JobQueue, timeoutMs = 1000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (queue.activeCount > 0 || queue.pendingCount > 0) {
    if (Date.now() > deadline) throw new Error("queue did not go idle in time");
    await delay(1);
  }
}

describe("JobQueue", () => {
  // ── Original enqueue() behaviour ───────────────────────────────────────────

  it("never runs more jobs concurrently than the configured limit", async () => {
    const queue = new JobQueue(2);
    let current = 0;
    let maxObserved = 0;
    const completed: number[] = [];

    const jobs = Array.from({ length: 6 }, (_, i) => i);
    const done = jobs.map(
      (i) =>
        new Promise<void>((resolve) => {
          queue.enqueue(async () => {
            current++;
            maxObserved = Math.max(maxObserved, current);
            await delay(20);
            current--;
            completed.push(i);
            resolve();
          });
        }),
    );

    await Promise.all(done);
    await waitUntilIdle(queue);

    expect(maxObserved).toBeLessThanOrEqual(2);
    expect(completed.sort((a, b) => a - b)).toEqual(jobs);
    expect(queue.activeCount).toBe(0);
    expect(queue.pendingCount).toBe(0);
  });

  it("keeps draining the backlog after a job throws instead of getting stuck", async () => {
    const queue = new JobQueue(1);
    const order: string[] = [];

    await new Promise<void>((resolve) => {
      queue.enqueue(async () => {
        order.push("first");
        throw new Error("simulated job failure");
      });
      queue.enqueue(async () => {
        order.push("second");
        resolve();
      });
    });

    await waitUntilIdle(queue);
    expect(order).toEqual(["first", "second"]);
    expect(queue.activeCount).toBe(0);
  });

  it("rejects a non-positive-integer concurrency", () => {
    expect(() => new JobQueue(0)).toThrow();
    expect(() => new JobQueue(-1)).toThrow();
    expect(() => new JobQueue(1.5)).toThrow();
  });

  it("runs jobs immediately (not queued) while under the concurrency limit", async () => {
    const queue = new JobQueue(3);
    let started = false;
    queue.enqueue(async () => {
      started = true;
    });
    // The queue dispatches synchronously inside enqueue() — no need to
    // await a microtask for `running` to reflect the new job.
    expect(queue.activeCount).toBe(1);
    await delay(0);
    expect(started).toBe(true);
  });

  // ── PR-D1: enqueueWithId() deduplication ──────────────────────────────────

  it("enqueueWithId returns true on first enqueue and false on duplicate", async () => {
    const queue = new JobQueue(1);

    // Block the slot so the first job stays pending
    let release!: () => void;
    const blocker = new Promise<void>((res) => { release = res; });
    queue.enqueue(() => blocker); // occupies the one running slot

    // At this point the queue has capacity=1, running=1. The next job waits.
    const added1 = queue.enqueueWithId("job-abc", async () => {});
    expect(added1).toBe(true);
    expect(queue.pendingCount).toBe(1);
    expect(queue.has("job-abc")).toBe(true);

    // Duplicate enqueue returns false and does NOT add to pending
    const added2 = queue.enqueueWithId("job-abc", async () => {});
    expect(added2).toBe(false);
    expect(queue.pendingCount).toBe(1); // still 1, not 2

    release();
    await waitUntilIdle(queue);
  });

  it("has() returns true while job is pending and false after it completes", async () => {
    const queue = new JobQueue(1);
    let release!: () => void;
    const blocker = new Promise<void>((res) => { release = res; });

    // Occupy the slot
    queue.enqueue(() => blocker);

    queue.enqueueWithId("my-job", async () => {});
    expect(queue.has("my-job")).toBe(true);

    // Release the blocker — my-job now runs and completes
    release();
    await waitUntilIdle(queue);

    // After completion the ID should be cleared
    expect(queue.has("my-job")).toBe(false);
  });

  it("has() returns true while job is actively running", async () => {
    const queue = new JobQueue(2);
    let release!: () => void;
    const running = new Promise<void>((res) => { release = res; });

    queue.enqueueWithId("running-job", () => running);

    // Let the job start executing
    await delay(5);
    expect(queue.has("running-job")).toBe(true);
    expect(queue.activeCount).toBe(1);

    release();
    await waitUntilIdle(queue);
    expect(queue.has("running-job")).toBe(false);
  });

  it("allows re-enqueueing the same ID after it has completed", async () => {
    const queue = new JobQueue(2);
    const executed: string[] = [];

    const first = new Promise<void>((resolve) => {
      queue.enqueueWithId("reuse-id", async () => {
        executed.push("run-1");
        resolve();
      });
    });
    await first;
    await waitUntilIdle(queue);

    expect(queue.has("reuse-id")).toBe(false);

    // Same ID, second enqueue — should succeed and execute
    const second = new Promise<void>((resolve) => {
      const added = queue.enqueueWithId("reuse-id", async () => {
        executed.push("run-2");
        resolve();
      });
      expect(added).toBe(true);
    });
    await second;
    await waitUntilIdle(queue);

    expect(executed).toEqual(["run-1", "run-2"]);
  });

  it("enqueueWithId jobs respect the concurrency limit like anonymous jobs", async () => {
    const queue = new JobQueue(2);
    let current = 0;
    let maxObserved = 0;

    const done = ["a", "b", "c", "d"].map(
      (id) =>
        new Promise<void>((resolve) => {
          queue.enqueueWithId(id, async () => {
            current++;
            maxObserved = Math.max(maxObserved, current);
            await delay(20);
            current--;
            resolve();
          });
        }),
    );

    await Promise.all(done);
    await waitUntilIdle(queue);
    expect(maxObserved).toBeLessThanOrEqual(2);
  });

  it("keeps draining after an enqueueWithId job throws", async () => {
    const queue = new JobQueue(1);
    const order: string[] = [];

    await new Promise<void>((resolve) => {
      queue.enqueueWithId("throw-job", async () => {
        order.push("first");
        throw new Error("enqueueWithId job failure");
      });
      queue.enqueueWithId("ok-job", async () => {
        order.push("second");
        resolve();
      });
    });

    await waitUntilIdle(queue);
    expect(order).toEqual(["first", "second"]);
    // ID should be cleaned up even after a throw
    expect(queue.has("throw-job")).toBe(false);
  });

  it("getStats reflects pending and running counts for enqueueWithId jobs", async () => {
    const queue = new JobQueue(1);
    let release!: () => void;
    const blocker = new Promise<void>((res) => { release = res; });

    queue.enqueueWithId("stat-1", () => blocker);
    queue.enqueueWithId("stat-2", async () => {});

    await delay(5); // let stat-1 start running
    const stats = queue.getStats();
    expect(stats.running).toBe(1);
    expect(stats.queued).toBe(1);
    expect(stats.concurrency).toBe(1);

    release();
    await waitUntilIdle(queue);
  });
});
