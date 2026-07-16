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
});
