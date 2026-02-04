#!/usr/bin/env node

import https from 'https';

const DOMAIN = process.argv[2];

if (!DOMAIN) {
  console.error('Usage: node verify-deployment.js <domain>');
  process.exit(1);
}

const endpoints = [
  { path: '/api/health', name: 'Health Check' },
  { path: '/', name: 'Homepage', contentType: 'text/html' },
  { path: '/api/quotes', name: 'Quotes API' },
  { path: '/api/authors', name: 'Authors API' },
  { path: '/api/settings', name: 'Settings API' },
  { path: '/api/logs', name: 'Logs API' },
  { path: '/api/logs/stats', name: 'Logs Stats API' },
  { path: '/manifest.json', name: 'PWA Manifest' },
  { path: '/sw.js', name: 'Service Worker', contentType: 'application/javascript' },
];

async function checkEndpoint(endpoint) {
  return new Promise((resolve) => {
    const url = `https://${DOMAIN}${endpoint.path}`;

    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        const success = res.statusCode === 200;
        console.log(`${success ? 'PASS' : 'FAIL'} ${endpoint.name}: ${res.statusCode}`);

        if (success && endpoint.path === '/') {
          const hasTitle = data.includes('Quote Log');
          const hasSettings = data.includes('settings') || data.includes('Settings');
          console.log(`   ${hasTitle ? 'PASS' : 'FAIL'} Title "Quote Log" present`);
          console.log(`   ${hasSettings ? 'PASS' : 'FAIL'} Settings link present`);
        }

        resolve(success);
      });
    }).on('error', (err) => {
      console.log(`FAIL ${endpoint.name}: ${err.message}`);
      resolve(false);
    });
  });
}

async function main() {
  console.log(`\nVerifying deployment at: ${DOMAIN}\n`);

  const results = [];
  for (const endpoint of endpoints) {
    results.push(await checkEndpoint(endpoint));
  }

  const passed = results.filter(r => r).length;
  const total = results.length;

  console.log(`\nResults: ${passed}/${total} checks passed\n`);

  if (passed === total) {
    console.log('Deployment verification PASSED!\n');
    process.exit(0);
  } else {
    console.log('Deployment verification FAILED - some checks did not pass\n');
    process.exit(1);
  }
}

main();
