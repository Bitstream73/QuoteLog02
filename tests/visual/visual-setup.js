import puppeteer from 'puppeteer';
import { createApp } from '../../src/index.js';

let server;
let browser;
let baseUrl;

/**
 * Start Express server on a random port and launch Puppeteer browser.
 */
export async function startServer() {
  process.env.NODE_ENV = 'test';
  process.env.GEMINI_API_KEY = 'test-key';

  const app = createApp();
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      const port = server.address().port;
      baseUrl = `http://localhost:${port}`;
      resolve();
    });
  });

  browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  return { browser, baseUrl, server };
}

/**
 * Get a new page with specified viewport.
 */
export async function getPage(width = 1280, height = 800) {
  const page = await browser.newPage();
  await page.setViewport({ width, height });
  return page;
}

/**
 * Get the base URL.
 */
export function getBaseUrl() {
  return baseUrl;
}

/**
 * Stop the server and close the browser.
 */
export async function stopServer() {
  if (browser) await browser.close();
  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
  try {
    const { closeDb } = await import('../../src/config/database.js');
    closeDb();
  } catch {}
}
