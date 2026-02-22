/**
 * factCheckQueue.js — In-memory FIFO queue with deduplication and concurrency control.
 *
 * Prevents simultaneous Gemini API calls from overwhelming the rate limit.
 * Duplicate requests (same key) return the same promise.
 */

const DEFAULT_CONCURRENCY = 2;

class FactCheckQueue {
  constructor(concurrency = DEFAULT_CONCURRENCY) {
    this._concurrency = concurrency;
    this._active = 0;
    this._queue = [];           // { key, fn, resolve, reject }
    this._promises = new Map(); // key → user-facing Promise (dedup for both pending + in-flight)
  }

  get pending() { return this._queue.length; }
  get active() { return this._active; }

  positionOf(key) {
    if (!this._promises.has(key)) return -1;   // not in queue
    const idx = this._queue.findIndex(item => item.key === key);
    if (idx === -1) return 0;                   // in-flight (running now)
    return idx + 1;                             // 1-based waiting position
  }

  /**
   * Enqueue a task. If a task with the same key is already queued or in-flight,
   * returns the existing promise (deduplication).
   *
   * @param {string} key - Deduplication key (e.g. `q:${quoteId}`)
   * @param {Function} fn - Async function to execute
   * @returns {Promise} Result of fn()
   */
  enqueue(key, fn) {
    if (this._promises.has(key)) {
      return this._promises.get(key);
    }

    const promise = new Promise((resolve, reject) => {
      this._queue.push({ key, fn, resolve, reject });
    });

    this._promises.set(key, promise);
    this._drain();
    return promise;
  }

  _drain() {
    while (this._active < this._concurrency && this._queue.length > 0) {
      const item = this._queue.shift();
      this._active++;

      Promise.resolve()
        .then(() => item.fn())
        .then(result => {
          item.resolve(result);
        })
        .catch(err => {
          item.reject(err);
        })
        .finally(() => {
          this._promises.delete(item.key);
          this._active--;
          this._drain();
        });
    }
  }
}

const factCheckQueue = new FactCheckQueue();
export default factCheckQueue;
export { FactCheckQueue };
