import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('Settings Page Source Twirl-Down', () => {
  const settingsJs = fs.readFileSync(path.join(process.cwd(), 'public/js/settings.js'), 'utf-8');

  it('sources list renders inside a details element', () => {
    expect(settingsJs).toContain('sources-details');
    expect(settingsJs).toContain('<details');
    expect(settingsJs).toContain('<summary>');
  });

  it('details element is closed by default (no open attribute)', () => {
    // The details element should not have the open attribute by default
    const detailsMatch = settingsJs.match(/<details\s+class="sources-details"[^>]*>/);
    expect(detailsMatch).toBeTruthy();
    expect(detailsMatch[0]).not.toContain('open');
  });

  it('summary text includes source count', () => {
    // Summary should contain dynamic source count
    expect(settingsJs).toMatch(/Sources\s*\(/);
  });
});
