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

describe('Settings Page Tab Bar', () => {
  it('renders a tab bar with 7 tabs', () => {
    expect(settingsJs).toContain('settings-tab-bar');
    // Count tab buttons (onclick="switchSettingsTab) not the querySelector in the function
    const tabButtonMatches = settingsJs.match(/onclick="switchSettingsTab\(/g);
    expect(tabButtonMatches).toHaveLength(7);
  });

  it('has all expected tab IDs', () => {
    const tabIds = ['general', 'data-sources', 'ingest', 'backfilling', 'noteworthy', 'metadata', 'logs'];
    for (const tabId of tabIds) {
      expect(settingsJs).toContain(`data-tab="${tabId}"`);
      expect(settingsJs).toContain(`id="settings-tab-${tabId}"`);
    }
  });

  it('general tab is active by default', () => {
    expect(settingsJs).toContain('settings-tab active" onclick="switchSettingsTab(\'general\')');
    expect(settingsJs).toContain('settings-tab-content active" id="settings-tab-general"');
  });

  it('other tabs are not active by default', () => {
    // data-sources tab content should not have active class
    expect(settingsJs).toContain('settings-tab-content" id="settings-tab-data-sources"');
    expect(settingsJs).toContain('settings-tab-content" id="settings-tab-ingest"');
    expect(settingsJs).toContain('settings-tab-content" id="settings-tab-logs"');
  });

  it('defines switchSettingsTab function', () => {
    expect(settingsJs).toContain('function switchSettingsTab(tabId)');
  });

  it('switchSettingsTab toggles active classes', () => {
    expect(settingsJs).toContain("'.settings-tab'");
    expect(settingsJs).toContain("'.settings-tab-content'");
    expect(settingsJs).toContain('classList.remove(\'active\')');
    expect(settingsJs).toContain('classList.add(\'active\')');
  });

  it('has CSS for settings tab bar', () => {
    expect(stylesCss).toContain('.settings-tab-bar');
    expect(stylesCss).toContain('.settings-tab');
    expect(stylesCss).toContain('.settings-tab.active');
    expect(stylesCss).toContain('.settings-tab-content');
    expect(stylesCss).toContain('.settings-tab-content.active');
  });

  it('tab content uses display none/block pattern', () => {
    expect(stylesCss).toContain('.settings-tab-content {');
    expect(stylesCss).toMatch(/\.settings-tab-content\s*\{[^}]*display:\s*none/);
    expect(stylesCss).toMatch(/\.settings-tab-content\.active\s*\{[^}]*display:\s*block/);
  });

  it('sections are placed in correct tabs', () => {
    // Appearance in general tab
    const generalTabMatch = settingsJs.match(/id="settings-tab-general"[\s\S]*?<!-- \/general tab -->/);
    expect(generalTabMatch).toBeTruthy();
    expect(generalTabMatch[0]).toContain('Appearance');

    // Fetch Settings in ingest tab
    const ingestTabMatch = settingsJs.match(/id="settings-tab-ingest"[\s\S]*?<!-- \/ingest tab -->/);
    expect(ingestTabMatch).toBeTruthy();
    expect(ingestTabMatch[0]).toContain('Fetch Settings');
    expect(ingestTabMatch[0]).toContain('Disambiguation Settings');
    expect(ingestTabMatch[0]).toContain('Ingest Filters');
    expect(ingestTabMatch[0]).toContain('AI Prompts');

    // Historical Sources in backfilling tab
    const backfillingMatch = settingsJs.match(/id="settings-tab-backfilling"[\s\S]*?<!-- \/backfilling tab -->/);
    expect(backfillingMatch).toBeTruthy();
    expect(backfillingMatch[0]).toContain('Historical Sources');

    // Keywords, Topics, Categories in metadata tab
    const metadataMatch = settingsJs.match(/id="settings-tab-metadata"[\s\S]*?<!-- \/metadata tab -->/);
    expect(metadataMatch).toBeTruthy();
    expect(metadataMatch[0]).toContain('settings-section-keywords');
    expect(metadataMatch[0]).toContain('settings-section-topics');
    expect(metadataMatch[0]).toContain('settings-section-categories');

    // Logs in logs tab
    const logsMatch = settingsJs.match(/id="settings-tab-logs"[\s\S]*?<!-- \/logs tab -->/);
    expect(logsMatch).toBeTruthy();
    expect(logsMatch[0]).toContain('logs-section');
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

describe('Noteworthy Cards Settings UI — Peppered Card Configs', () => {
  it('fetches card configs from admin API', () => {
    expect(settingsJs).toContain("API.get('/admin/noteworthy-configs')");
  });

  it('renders card configs list container', () => {
    expect(settingsJs).toContain('id="card-configs-list"');
  });

  it('has Peppered Card Configs subsection title', () => {
    expect(settingsJs).toContain('Peppered Card Configs');
  });

  it('renders pepper settings controls in noteworthy tab', () => {
    const noteworthyTab = settingsJs.match(/id="settings-tab-noteworthy"[\s\S]*?<!-- \/noteworthy tab -->/);
    expect(noteworthyTab).toBeTruthy();
    // Pepper frequency input
    expect(noteworthyTab[0]).toContain('noteworthy_pepper_frequency');
    // Pepper chance slider
    expect(noteworthyTab[0]).toContain('noteworthy_pepper_chance');
    // Pick mode select
    expect(noteworthyTab[0]).toContain('noteworthy_pick_mode');
    // Reuse toggle
    expect(noteworthyTab[0]).toContain('noteworthy_reuse_cards');
  });

  it('pepper frequency uses number input', () => {
    expect(settingsJs).toMatch(/type="number"[^>]*noteworthy_pepper_frequency/);
  });

  it('pepper chance uses range slider', () => {
    expect(settingsJs).toMatch(/type="range"[^>]*noteworthy_pepper_chance/);
  });

  it('pick mode uses select with sequential and random options', () => {
    expect(settingsJs).toContain('value="sequential"');
    expect(settingsJs).toContain('value="random"');
  });

  it('reuse cards uses checkbox toggle', () => {
    expect(settingsJs).toMatch(/type="checkbox"[^>]*noteworthy_reuse_cards/);
  });

  it('defines formatCardType function', () => {
    expect(settingsJs).toContain('function formatCardType(');
  });

  it('defines renderCardConfigRow function', () => {
    expect(settingsJs).toContain('function renderCardConfigRow(');
  });

  it('defines toggleCardConfig function', () => {
    expect(settingsJs).toContain('async function toggleCardConfig(');
  });

  it('defines updateCardConfigTitle function', () => {
    expect(settingsJs).toContain('async function updateCardConfigTitle(');
  });

  it('defines updateCardConfigCollection function', () => {
    expect(settingsJs).toContain('async function updateCardConfigCollection(');
  });

  it('defines refreshCardConfigs function', () => {
    expect(settingsJs).toContain('async function refreshCardConfigs(');
  });

  it('renderCardConfigRow includes toggle, type badge, title input, collection select', () => {
    expect(settingsJs).toContain('noteworthy-config-row');
    expect(settingsJs).toContain('config-type-badge');
    expect(settingsJs).toContain('toggleCardConfig(');
    expect(settingsJs).toContain('updateCardConfigTitle(');
    expect(settingsJs).toContain('updateCardConfigCollection(');
  });

  it('has CSS for noteworthy config row and type badge', () => {
    expect(stylesCss).toContain('.noteworthy-config-row');
    expect(stylesCss).toContain('.config-type-badge');
  });

  it('pepper settings use updateSetting for persistence', () => {
    // All pepper settings should call updateSetting
    const pepperSection = settingsJs.match(/Peppered Card Configs[\s\S]*?card-configs-list/);
    expect(pepperSection).toBeTruthy();
    expect(pepperSection[0]).toContain("updateSetting('noteworthy_pepper_frequency'");
    expect(pepperSection[0]).toContain("updateSetting('noteworthy_pepper_chance'");
    expect(pepperSection[0]).toContain("updateSetting('noteworthy_pick_mode'");
    expect(pepperSection[0]).toContain("updateSetting('noteworthy_reuse_cards'");
  });
});
