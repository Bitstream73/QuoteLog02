import { describe, it, expect } from 'vitest';
import { FactCheckQueue } from '../../src/services/factCheckQueue.js';

describe('FactCheckQueue', () => {
  it('should process tasks in FIFO order', async () => {
    const order = [];
    const queue = new FactCheckQueue(1);

    const p1 = queue.enqueue('a', async () => { order.push('a'); return 'a'; });
    const p2 = queue.enqueue('b', async () => { order.push('b'); return 'b'; });
    const p3 = queue.enqueue('c', async () => { order.push('c'); return 'c'; });

    await Promise.all([p1, p2, p3]);
    expect(order).toEqual(['a', 'b', 'c']);
  });

  it('should deduplicate queued tasks with same key', async () => {
    let callCount = 0;
    const queue = new FactCheckQueue(1);

    // Block the first slot so subsequent enqueues go to the pending queue
    let unblock;
    const blocker = new Promise(r => { unblock = r; });
    const p0 = queue.enqueue('blocker', () => blocker);

    const p1 = queue.enqueue('dup', async () => { callCount++; return 'result'; });
    const p2 = queue.enqueue('dup', async () => { callCount++; return 'result2'; });

    // p1 and p2 should be the same promise (dedup)
    expect(p1).toBe(p2);

    unblock('done');
    await p0;
    const result = await p1;

    expect(result).toBe('result');
    expect(callCount).toBe(1);
  });

  it('should deduplicate in-flight tasks with same key', async () => {
    let callCount = 0;
    const queue = new FactCheckQueue(2);

    let resolve1;
    const p1 = queue.enqueue('inflight', () => new Promise(r => {
      callCount++;
      resolve1 = r;
    }));

    // Allow the microtask from _drain to execute fn (assigns resolve1)
    await new Promise(r => setTimeout(r, 10));

    // p1 is now in-flight; enqueueing same key should return same promise
    const p2 = queue.enqueue('inflight', async () => { callCount++; return 'should not run'; });

    expect(p1).toBe(p2);

    resolve1('original');
    const result = await p1;
    expect(result).toBe('original');
    expect(callCount).toBe(1);
  });

  it('should respect concurrency limit', async () => {
    const queue = new FactCheckQueue(2);
    let concurrent = 0;
    let maxConcurrent = 0;

    const task = () => new Promise(resolve => {
      concurrent++;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      setTimeout(() => { concurrent--; resolve(); }, 20);
    });

    const promises = [];
    for (let i = 0; i < 6; i++) {
      promises.push(queue.enqueue(`task-${i}`, task));
    }

    await Promise.all(promises);
    expect(maxConcurrent).toBeLessThanOrEqual(2);
    expect(maxConcurrent).toBe(2);
  });

  it('should propagate errors without stopping the queue', async () => {
    const queue = new FactCheckQueue(1);
    const results = [];

    const p1 = queue.enqueue('fail', async () => { throw new Error('boom'); });
    const p2 = queue.enqueue('ok', async () => { results.push('ok'); return 'ok'; });

    // Catch p1 to prevent unhandled rejection
    const err = await p1.catch(e => e);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe('boom');

    const r2 = await p2;
    expect(r2).toBe('ok');
    expect(results).toEqual(['ok']);
  });

  it('should report pending and active counts', async () => {
    const queue = new FactCheckQueue(1);

    let unblock;
    const blocker = new Promise(r => { unblock = r; });

    const p0 = queue.enqueue('active', () => blocker);

    // p0 is active, so these should be pending
    const p1 = queue.enqueue('pend1', async () => 'a');
    const p2 = queue.enqueue('pend2', async () => 'b');

    expect(queue.active).toBe(1);
    expect(queue.pending).toBe(2);

    unblock('done');
    await Promise.all([p0, p1, p2]);

    // Allow microtasks (.finally) to complete
    await new Promise(r => setTimeout(r, 10));

    expect(queue.active).toBe(0);
    expect(queue.pending).toBe(0);
  });
});
