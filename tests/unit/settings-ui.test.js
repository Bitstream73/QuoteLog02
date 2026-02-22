import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const settingsJs = fs.readFileSync(path.join(process.cwd(), 'public/js/settings.js'), 'utf-8');
const stylesCss = fs.readFileSync(path.join(process.cwd(), 'public/css/styles.css'), 'utf-8');

describe('Settings Page Source Twirl-Down', () => {
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

describe('Settings Page Keywords Section', () => {
  it('has a keywords section with correct id', () => {
    expect(settingsJs).toContain('id="settings-section-keywords"');
  });

  it('fetches keywords from admin API', () => {
    expect(settingsJs).toContain("API.get('/admin/keywords')");
  });

  it('has an add keyword form with name and aliases inputs', () => {
    expect(settingsJs).toContain('id="new-keyword-name"');
    expect(settingsJs).toContain('id="new-keyword-aliases"');
    expect(settingsJs).toContain('onclick="addKeyword()"');
  });

  it('has a filter input for keywords', () => {
    expect(settingsJs).toContain('id="keywords-filter"');
    expect(settingsJs).toContain('filterKeywords()');
  });

  it('defines all CRUD functions for keywords', () => {
    expect(settingsJs).toContain('async function addKeyword()');
    expect(settingsJs).toContain('async function editKeyword(');
    expect(settingsJs).toContain('async function deleteKeyword(');
    expect(settingsJs).toContain('async function addAlias(');
    expect(settingsJs).toContain('async function deleteAlias(');
  });

  it('renders keyword cards with details/summary pattern', () => {
    expect(settingsJs).toContain('keyword-card');
    expect(settingsJs).toContain('keyword-card__summary');
    expect(settingsJs).toContain('keyword-card__body');
  });

  it('uses showConfirmToast for delete (not confirm/alert)', () => {
    // deleteKeyword should use showConfirmToast
    const deleteMatch = settingsJs.match(/async function deleteKeyword[\s\S]*?^}/m);
    expect(deleteMatch).toBeTruthy();
    expect(deleteMatch[0]).toContain('showConfirmToast');
  });

  it('uses showToast for notifications (not alert)', () => {
    // addKeyword should use showToast
    expect(settingsJs).toContain("showToast('Keyword added'");
    expect(settingsJs).toContain("showToast('Keyword deleted'");
    expect(settingsJs).toContain("showToast('Alias added'");
    expect(settingsJs).toContain("showToast('Alias removed'");
  });

  it('renders keyword alias chips with remove button', () => {
    expect(settingsJs).toContain('keyword-alias-chip');
    expect(settingsJs).toContain('keyword-alias-remove');
  });

  it('has reloadKeywords function that preserves open state', () => {
    expect(settingsJs).toContain('async function reloadKeywords()');
    expect(settingsJs).toContain('openIds');
  });

  it('has CSS styles for keyword card components', () => {
    expect(stylesCss).toContain('.keyword-card');
    expect(stylesCss).toContain('.keyword-card__summary');
    expect(stylesCss).toContain('.keyword-card__body');
    expect(stylesCss).toContain('.keyword-alias-chip');
    expect(stylesCss).toContain('.keyword-alias-remove');
    expect(stylesCss).toContain('.keyword-add-form');
  });
});
