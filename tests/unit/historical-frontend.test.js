import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import path from 'path';

// Read the settings.js source so we can extract and test renderHistoricalSourceRow
const settingsSource = fs.readFileSync(
  path.join(process.cwd(), 'public/js/settings.js'),
  'utf-8'
);

// Provide a minimal escapeHtml for testing
function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Extract renderHistoricalSourceRow function from settings.js source
// We'll eval it in a controlled scope with escapeHtml available
let renderHistoricalSourceRow;

beforeAll(() => {
  // Extract just the renderHistoricalSourceRow function
  const fnMatch = settingsSource.match(/function renderHistoricalSourceRow\(source\)\s*\{/);
  if (!fnMatch) throw new Error('Could not find renderHistoricalSourceRow in settings.js');

  const startIdx = fnMatch.index;
  // Find the matching closing brace
  let braceCount = 0;
  let endIdx = startIdx;
  let inString = false;
  let stringChar = '';

  for (let i = startIdx; i < settingsSource.length; i++) {
    const ch = settingsSource[i];

    if (inString) {
      if (ch === stringChar && settingsSource[i - 1] !== '\\') {
        inString = false;
      }
      continue;
    }

    if (ch === "'" || ch === '"' || ch === '`') {
      inString = true;
      stringChar = ch;
      continue;
    }

    if (ch === '{') braceCount++;
    if (ch === '}') {
      braceCount--;
      if (braceCount === 0) {
        endIdx = i + 1;
        break;
      }
    }
  }

  const fnSource = settingsSource.substring(startIdx, endIdx);

  // Create the function in a scope with escapeHtml
  // eslint-disable-next-line no-new-func
  renderHistoricalSourceRow = new Function(
    'escapeHtml',
    'source',
    fnSource.replace('function renderHistoricalSourceRow(source)', '') // remove signature, keep body
  ).bind(null, escapeHtml);
});

describe('renderHistoricalSourceRow', () => {
  const workingSource = {
    provider_key: 'wikiquote',
    name: 'Wikiquote',
    description: 'Quotes from Wikiquote via MediaWiki API',
    enabled: true,
    status: 'working',
    total_articles_fetched: 142,
    last_error: null,
  };

  const failedSource = {
    provider_key: 'govinfo',
    name: 'GovInfo',
    description: 'Congressional Record speeches via GovInfo API',
    enabled: true,
    status: 'failed',
    total_articles_fetched: 50,
    last_error: 'API key expired',
  };

  const disabledSource = {
    provider_key: 'wayback',
    name: 'Wayback Machine',
    description: 'Historical snapshots via Wayback Machine CDX API',
    enabled: false,
    status: 'disabled',
    total_articles_fetched: 0,
    last_error: null,
  };

  const unknownSource = {
    provider_key: 'chronicling_america',
    name: 'Chronicling America',
    description: 'Library of Congress historical newspapers',
    enabled: true,
    status: 'unknown',
    total_articles_fetched: 10,
    last_error: null,
  };

  it('renders working status dot correctly', () => {
    const html = renderHistoricalSourceRow(workingSource);
    expect(html).toContain('status-dot-working');
    expect(html).toContain('title="Working"');
  });

  it('renders failed status dot correctly', () => {
    const html = renderHistoricalSourceRow(failedSource);
    expect(html).toContain('status-dot-failed');
    expect(html).toContain('title="Failed"');
  });

  it('renders disabled status dot correctly', () => {
    const html = renderHistoricalSourceRow(disabledSource);
    expect(html).toContain('status-dot-disabled');
    expect(html).toContain('title="Disabled"');
  });

  it('renders unknown status dot correctly', () => {
    const html = renderHistoricalSourceRow(unknownSource);
    expect(html).toContain('status-dot-disabled');
    expect(html).toContain('title="Unknown"');
  });

  it('renders provider name and description', () => {
    const html = renderHistoricalSourceRow(workingSource);
    expect(html).toContain('Wikiquote');
    expect(html).toContain('Quotes from Wikiquote via MediaWiki API');
  });

  it('renders data-key attribute', () => {
    const html = renderHistoricalSourceRow(workingSource);
    expect(html).toContain('data-key="wikiquote"');
  });

  it('renders article count', () => {
    const html = renderHistoricalSourceRow(workingSource);
    expect(html).toContain('142 articles');
  });

  it('renders Test button with correct id', () => {
    const html = renderHistoricalSourceRow(workingSource);
    expect(html).toContain('id="test-btn-wikiquote"');
    expect(html).toContain("testHistoricalSource('wikiquote')");
  });

  it('renders toggle with correct onclick for enabled source', () => {
    const html = renderHistoricalSourceRow(workingSource);
    expect(html).toContain("toggleHistoricalSource('wikiquote'");
    expect(html).toContain('checked');
  });

  it('renders toggle without checked for disabled source', () => {
    const html = renderHistoricalSourceRow(disabledSource);
    // The toggle checkbox should not have the standalone 'checked' attribute
    // but will still have 'this.checked' in the onchange handler
    const checkboxMatch = html.match(/<input type="checkbox"([^>]*)>/);
    expect(checkboxMatch).toBeTruthy();
    // Remove the onchange attribute content before checking for 'checked'
    const attrsWithoutOnchange = checkboxMatch[1].replace(/onchange="[^"]*"/, '');
    expect(attrsWithoutOnchange).not.toContain('checked');
  });

  it('renders error warning for failed source', () => {
    const html = renderHistoricalSourceRow(failedSource);
    expect(html).toContain('source-warning');
    expect(html).toContain('API key expired');
  });

  it('does not render error warning when no last_error', () => {
    const html = renderHistoricalSourceRow(workingSource);
    expect(html).not.toContain('source-warning');
  });

  it('escapes HTML in provider name', () => {
    const xssSource = { ...workingSource, name: '<script>alert("xss")</script>' };
    const html = renderHistoricalSourceRow(xssSource);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('has correct CSS classes', () => {
    const html = renderHistoricalSourceRow(workingSource);
    expect(html).toContain('source-row');
    expect(html).toContain('historical-source-row');
    expect(html).toContain('source-info');
    expect(html).toContain('source-actions');
    expect(html).toContain('historical-stat');
    expect(html).toContain('status-dot');
  });
});

describe('settings.js historical section HTML', () => {
  it('contains Historical Sources section', () => {
    expect(settingsSource).toContain('id="settings-section-historical"');
  });

  it('contains historical backfill toggle', () => {
    expect(settingsSource).toContain('historical_fetch_enabled');
  });

  it('contains articles per source setting', () => {
    expect(settingsSource).toContain('historical_articles_per_source_per_cycle');
  });

  it('contains historical-sources-list container', () => {
    expect(settingsSource).toContain('id="historical-sources-list"');
  });

  it('calls loadHistoricalSources after render', () => {
    expect(settingsSource).toContain('loadHistoricalSources()');
  });

  it('defines toggleHistoricalSource function', () => {
    expect(settingsSource).toContain('async function toggleHistoricalSource(');
  });

  it('defines testHistoricalSource function', () => {
    expect(settingsSource).toContain('async function testHistoricalSource(');
  });

  it('defines loadHistoricalSources function', () => {
    expect(settingsSource).toContain('async function loadHistoricalSources(');
  });
});
