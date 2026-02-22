import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const swipeJs = fs.readFileSync(path.join(process.cwd(), 'public/js/swipe.js'), 'utf-8');
const homeJs = fs.readFileSync(path.join(process.cwd(), 'public/js/home.js'), 'utf-8');
const stylesCss = fs.readFileSync(path.join(process.cwd(), 'public/css/styles.css'), 'utf-8');
const indexHtml = fs.readFileSync(path.join(process.cwd(), 'public/index.html'), 'utf-8');

describe('Swipe Gesture Module', () => {
  it('defines initSwipeHandlers function', () => {
    expect(swipeJs).toContain('function initSwipeHandlers(');
  });

  it('listens for touchstart events', () => {
    expect(swipeJs).toContain('touchstart');
  });

  it('listens for touchmove events', () => {
    expect(swipeJs).toContain('touchmove');
  });

  it('listens for touchend events', () => {
    expect(swipeJs).toContain('touchend');
  });

  it('uses passive event listeners', () => {
    expect(swipeJs).toContain('passive: true');
  });

  it('calculates horizontal distance (dx)', () => {
    expect(swipeJs).toContain('clientX');
  });

  it('calculates vertical distance (dy)', () => {
    expect(swipeJs).toContain('clientY');
  });

  it('computes velocity from distance and time', () => {
    expect(swipeJs).toContain('velocity');
  });

  it('ignores vertical scrolling (|dy| > |dx|)', () => {
    // Should have logic that returns early when vertical movement exceeds horizontal
    expect(swipeJs).toMatch(/Math\.abs\(dx\).*Math\.abs\(dy\)/);
  });

  it('supports configurable threshold', () => {
    expect(swipeJs).toContain('threshold');
  });

  it('supports velocity threshold', () => {
    expect(swipeJs).toContain('velocityThreshold');
  });

  it('calls onSwipeLeft callback for left swipes', () => {
    expect(swipeJs).toContain('onSwipeLeft');
  });

  it('calls onSwipeRight callback for right swipes', () => {
    expect(swipeJs).toContain('onSwipeRight');
  });
});

describe('Swipe Integration in home.js', () => {
  it('calls initSwipeHandlers in home.js', () => {
    expect(homeJs).toContain('initSwipeHandlers(');
  });

  it('uses navigateTo for left-swipe on quote blocks', () => {
    expect(homeJs).toContain("navigateTo('/quote/' + quoteId)");
  });

  it('does not use slideToDetail (removed)', () => {
    // slideToDetail was replaced by navigateTo
    expect(homeJs).not.toMatch(/function slideToDetail\(/);
  });

  it('does not use slideBack (removed)', () => {
    expect(homeJs).not.toMatch(/function slideBack\(/);
  });

  it('enables swipe-right-to-go-back on search results', () => {
    expect(homeJs).toContain('initPageSwipe');
  });
});

describe('Slide CSS Classes (legacy, kept for compatibility)', () => {
  it('has slide-container styles', () => {
    expect(stylesCss).toContain('.slide-container');
  });

  it('has slide-panel styles', () => {
    expect(stylesCss).toContain('.slide-panel');
  });

  it('uses translateX for slide transitions', () => {
    expect(stylesCss).toContain('translateX');
  });
});

describe('swipe.js script tag in index.html', () => {
  it('includes swipe.js script tag', () => {
    expect(indexHtml).toContain('swipe.js');
  });
});
