import { readFileSync } from 'fs';

const raw = readFileSync('test-output.txt', 'utf8');
const clean = raw.replace(/\x1b\[[0-9;]*m/g, '');
const lines = clean.split('\n');
const results = [];

for (const line of lines) {
  // Match vitest default reporter summary lines like:
  //  ✓ tests/unit/foo.test.js (5 tests) 1234ms
  //  × tests/unit/bar.test.js (3 tests | 1 failed) 567ms
  const match = line.match(/[✓×]\s+(tests\/\S+\.test\.js)\s+\([^)]+\)\s+(\d+)ms/);
  if (match) {
    results.push({ file: match[1], ms: parseInt(match[2]) });
  }
}

results.sort((a, b) => b.ms - a.ms);

console.log('=== All Test File Durations (slowest first) ===');
for (const r of results) {
  const flag = r.ms > 10000 ? ' *** SLOW ***' : '';
  console.log(`${r.file.padEnd(60)} ${(r.ms / 1000).toFixed(2)}s${flag}`);
}

console.log(`\nTotal files: ${results.length}`);
console.log(`Slow files (>10s): ${results.filter(r => r.ms > 10000).length}`);
