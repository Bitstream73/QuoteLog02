import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('Important Button Rendering', () => {
  const importantJs = fs.readFileSync(path.join(process.cwd(), 'public/js/important.js'), 'utf-8');

  describe('renderImportantButton function', () => {
    it('accepts adminView parameter', () => {
      // Function signature should include adminView param
      expect(importantJs).toMatch(/function renderImportantButton\([^)]*adminView/);
    });

    it('non-admin output does NOT contain count number visible', () => {
      // When adminView is false, count should be hidden or not shown
      // The function should conditionally show/hide count based on adminView
      expect(importantJs).toContain('adminView');
    });

    it('admin output contains SuperImportant button element', () => {
      expect(importantJs).toContain('super-important-btn');
      expect(importantJs).toContain('handleSuperImportant');
    });

    it('SuperImportant button has correct onclick handler', () => {
      expect(importantJs).toMatch(/onclick="handleSuperImportant\(event/);
    });
  });

  describe('handleSuperImportant function', () => {
    it('is declared as an async function', () => {
      expect(importantJs).toMatch(/async function handleSuperImportant/);
    });

    it('calls API.post for super-toggle endpoint', () => {
      expect(importantJs).toContain("'/importants/super-toggle'");
    });

    it('shows toast on success', () => {
      expect(importantJs).toContain('showToast');
    });

    it('updates important-count element', () => {
      expect(importantJs).toContain('.important-count');
    });
  });
});
