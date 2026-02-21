/**
 * Vitest global setup — logs per-test and per-file timing to the app's
 * logger under category "test".  Entries are written to the same
 * application_logs table used by the rest of the app, so they show up
 * in Settings → Logs when filtered to the "Test" category.
 *
 * Enabled via vitest.config.js → test.setupFiles.
 */
import { beforeAll, beforeEach, afterEach, afterAll } from 'vitest';

let logger;
let fileStart;
const currentFile = globalThis.__vitest_worker__?.filepath ?? 'unknown';

// Derive a short label from the absolute file path
function shortName(filepath) {
  const m = filepath.replace(/\\/g, '/').match(/tests\/(.+)$/);
  return m ? m[1] : filepath;
}

beforeAll(async () => {
  fileStart = performance.now();
  try {
    const mod = await import('../src/services/logger.js');
    logger = mod.default;
  } catch {
    // logger unavailable (e.g. config missing) — timing still prints to console
    logger = null;
  }
});

let testStart;

beforeEach(() => {
  testStart = performance.now();
});

afterEach((ctx) => {
  const ms = Math.round(performance.now() - testStart);
  const name = ctx?.task?.name ?? 'unknown test';
  const file = shortName(currentFile);
  const slow = ms > 10000;

  if (logger) {
    logger.info('test', slow ? 'slow_test' : 'test_complete', {
      test: name,
      file,
      durationMs: ms,
      slow,
    }, null, ms);
  }

  if (slow) {
    console.warn(`[SLOW TEST] ${file} > ${name} — ${ms}ms`);
  }
});

afterAll(() => {
  const ms = Math.round(performance.now() - fileStart);
  const file = shortName(currentFile);
  const slow = ms > 10000;

  if (logger) {
    logger.info('test', slow ? 'slow_file' : 'file_complete', {
      file,
      durationMs: ms,
      slow,
    }, null, ms);
  }

  if (slow) {
    console.warn(`[SLOW FILE] ${file} — ${ms}ms`);
  }
});
