import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('Review Page Tab Configuration', () => {
  const reviewJs = fs.readFileSync(path.join(process.cwd(), 'public/js/review.js'), 'utf-8');

  it('default active tab variable is quotes not disambiguation', () => {
    expect(reviewJs).toContain("let _reviewActiveTab = 'quotes'");
    expect(reviewJs).not.toContain("let _reviewActiveTab = 'disambiguation'");
  });

  it('tab render order has Quote Management first', () => {
    // Quote Management tab button should appear before Disambiguation Review
    const quoteTabIndex = reviewJs.indexOf("switchReviewTab('quotes')");
    const disambigTabIndex = reviewJs.indexOf("switchReviewTab('disambiguation')");
    // In renderReview(), the first tab button should be quotes
    // Find the tab bar section
    const tabBarMatch = reviewJs.match(/review-tab-bar[\s\S]*?<\/div>/);
    if (tabBarMatch) {
      const tabBarHtml = tabBarMatch[0];
      const quotesPos = tabBarHtml.indexOf('quotes');
      const disambigPos = tabBarHtml.indexOf('disambiguation');
      expect(quotesPos).toBeLessThan(disambigPos);
    }
  });

  it('disambiguation tab includes badge element with pending count', () => {
    expect(reviewJs).toContain('disambig-tab-badge');
  });

  it('has updateDisambigTabBadge function', () => {
    expect(reviewJs).toContain('function updateDisambigTabBadge');
  });
});
