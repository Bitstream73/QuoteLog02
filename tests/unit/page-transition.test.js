import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const appJs = fs.readFileSync(path.join(process.cwd(), 'public/js/app.js'), 'utf-8');
const pageTransitionJs = fs.readFileSync(path.join(process.cwd(), 'public/js/page-transition.js'), 'utf-8');
const stylesCss = fs.readFileSync(path.join(process.cwd(), 'public/css/styles.css'), 'utf-8');
const indexHtml = fs.readFileSync(path.join(process.cwd(), 'public/index.html'), 'utf-8');
const quoteJs = fs.readFileSync(path.join(process.cwd(), 'public/js/quote.js'), 'utf-8');
const articleJs = fs.readFileSync(path.join(process.cwd(), 'public/js/article.js'), 'utf-8');
const authorJs = fs.readFileSync(path.join(process.cwd(), 'public/js/author.js'), 'utf-8');
const topicJs = fs.readFileSync(path.join(process.cwd(), 'public/js/topic.js'), 'utf-8');
const categoryJs = fs.readFileSync(path.join(process.cwd(), 'public/js/category.js'), 'utf-8');

// ======= Navigation Stack =======

describe('Navigation Stack (app.js)', () => {
  it('declares _navStack array', () => {
    expect(appJs).toContain('const _navStack = []');
  });

  it('declares _navIndex counter', () => {
    expect(appJs).toContain('let _navIndex = 0');
  });

  it('defines navigateBack function', () => {
    expect(appJs).toContain('function navigateBack(');
  });

  it('navigateBackToQuotes is alias for navigateBack', () => {
    expect(appJs).toContain('function navigateBackToQuotes(');
    expect(appJs).toContain('navigateBack(event)');
  });

  it('navigate pushes to _navStack before navigation', () => {
    expect(appJs).toContain('_navStack.push(');
  });

  it('navigate caps stack at 10 entries', () => {
    expect(appJs).toContain('_navStack.length > 10');
  });

  it('navigate saves path, html, scrollY, timestamp', () => {
    expect(appJs).toContain('path: currentPath');
    expect(appJs).toContain('html: content.innerHTML');
    expect(appJs).toContain('scrollY: window.scrollY');
    expect(appJs).toContain('timestamp: Date.now()');
  });

  it('navigateBack pops from _navStack', () => {
    expect(appJs).toContain('_navStack.pop()');
  });

  it('navigateBack restores scrollY', () => {
    expect(appJs).toContain('entry.scrollY');
  });

  it('pushes navIndex into history.pushState', () => {
    expect(appJs).toContain('navIndex: _navIndex');
  });
});

// ======= Back Arrow Button =======

describe('Back Arrow Button (app.js)', () => {
  it('defines buildBackArrowHtml function', () => {
    expect(appJs).toContain('function buildBackArrowHtml()');
  });

  it('returns a button with class back-arrow-btn', () => {
    expect(appJs).toContain('back-arrow-btn');
  });

  it('calls navigateBack on click', () => {
    expect(appJs).toContain('onclick="navigateBack(event)"');
  });

  it('includes SVG arrow icon', () => {
    expect(appJs).toContain('<svg');
    expect(appJs).toContain('polyline');
  });
});

// ======= Page Transition Module =======

describe('Page Transition Module (page-transition.js)', () => {
  it('defines initPageTransitions function', () => {
    expect(pageTransitionJs).toContain('function initPageTransitions()');
  });

  it('defines transitionForward function', () => {
    expect(pageTransitionJs).toContain('function transitionForward(');
  });

  it('defines transitionBack function', () => {
    expect(pageTransitionJs).toContain('function transitionBack(');
  });

  it('defines initPageSwipe function', () => {
    expect(pageTransitionJs).toContain('function initPageSwipe(');
  });

  it('has _transitionInProgress guard', () => {
    expect(pageTransitionJs).toContain('_transitionInProgress');
  });

  it('respects prefers-reduced-motion', () => {
    expect(pageTransitionJs).toContain('prefers-reduced-motion');
  });

  it('uses page-slide-out-left animation', () => {
    expect(pageTransitionJs).toContain('page-slide-out-left');
  });

  it('uses page-slide-in-right animation', () => {
    expect(pageTransitionJs).toContain('page-slide-in-right');
  });

  it('uses page-slide-out-right animation for back', () => {
    expect(pageTransitionJs).toContain('page-slide-out-right');
  });

  it('uses page-slide-in-left animation for back', () => {
    expect(pageTransitionJs).toContain('page-slide-in-left');
  });

  it('cleans up transition layers on animationend', () => {
    expect(pageTransitionJs).toContain('animationend');
  });
});

// ======= Interactive Swipe (page-transition.js) =======

describe('Interactive Swipe (page-transition.js)', () => {
  it('listens for touchstart events', () => {
    expect(pageTransitionJs).toContain('touchstart');
  });

  it('listens for touchmove events', () => {
    expect(pageTransitionJs).toContain('touchmove');
  });

  it('listens for touchend events', () => {
    expect(pageTransitionJs).toContain('touchend');
  });

  it('uses passive event listeners', () => {
    expect(pageTransitionJs).toContain('passive: true');
  });

  it('calls navigateBack on right swipe', () => {
    expect(pageTransitionJs).toContain('navigateBack');
  });

  it('checks swipe threshold (80px)', () => {
    expect(pageTransitionJs).toContain('80');
  });

  it('checks velocity threshold (0.5)', () => {
    expect(pageTransitionJs).toContain('0.5');
  });
});

// ======= CSS Keyframes =======

describe('Page Transition CSS', () => {
  it('has page-slide-out-left keyframes', () => {
    expect(stylesCss).toContain('@keyframes page-slide-out-left');
  });

  it('has page-slide-in-right keyframes', () => {
    expect(stylesCss).toContain('@keyframes page-slide-in-right');
  });

  it('has page-slide-out-right keyframes', () => {
    expect(stylesCss).toContain('@keyframes page-slide-out-right');
  });

  it('has page-slide-in-left keyframes', () => {
    expect(stylesCss).toContain('@keyframes page-slide-in-left');
  });

  it('has back-arrow-btn styles', () => {
    expect(stylesCss).toContain('.back-arrow-btn');
  });

  it('back-arrow-btn is 36x36 circle', () => {
    expect(stylesCss).toContain('width: 36px');
    expect(stylesCss).toContain('height: 36px');
    expect(stylesCss).toContain('border-radius: 50%');
  });

  it('has prefers-reduced-motion override', () => {
    expect(stylesCss).toContain('prefers-reduced-motion');
  });

  it('uses 30% translateX for slide animations', () => {
    expect(stylesCss).toContain('translateX(-30%)');
    expect(stylesCss).toContain('translateX(30%)');
  });
});

// ======= Script Tag =======

describe('page-transition.js script tag in index.html', () => {
  it('includes page-transition.js script tag', () => {
    expect(indexHtml).toContain('page-transition.js');
  });

  it('page-transition.js is loaded after swipe.js and before home.js', () => {
    const swipeIdx = indexHtml.indexOf('swipe.js');
    const ptIdx = indexHtml.indexOf('page-transition.js');
    const homeIdx = indexHtml.indexOf('home.js');
    expect(ptIdx).toBeGreaterThan(swipeIdx);
    expect(ptIdx).toBeLessThan(homeIdx);
  });
});

// ======= Detail Pages Use Back Arrow =======

describe('Detail pages use buildBackArrowHtml()', () => {
  it('quote.js uses buildBackArrowHtml', () => {
    expect(quoteJs).toContain('buildBackArrowHtml()');
  });

  it('article.js uses buildBackArrowHtml', () => {
    expect(articleJs).toContain('buildBackArrowHtml()');
  });

  it('author.js uses buildBackArrowHtml', () => {
    expect(authorJs).toContain('buildBackArrowHtml()');
  });

  it('topic.js uses buildBackArrowHtml', () => {
    expect(topicJs).toContain('buildBackArrowHtml()');
  });

  it('category.js uses buildBackArrowHtml', () => {
    expect(categoryJs).toContain('buildBackArrowHtml()');
  });

  it('quote.js does not contain "Back to quotes" text link', () => {
    expect(quoteJs).not.toContain('Back to quotes</a>');
  });

  it('article.js does not contain "Back to quotes" text link', () => {
    expect(articleJs).not.toContain('Back to quotes</a>');
  });

  it('author.js does not contain "Back to quotes" text link', () => {
    expect(authorJs).not.toContain('Back to quotes</a>');
  });

  it('topic.js does not contain "Back to quotes" text link', () => {
    expect(topicJs).not.toContain('Back to quotes</a>');
  });

  it('category.js does not contain "Back to quotes" text link', () => {
    expect(categoryJs).not.toContain('Back to quotes</a>');
  });
});

// ======= Detail Pages Init Swipe =======

describe('Detail pages init swipe-to-go-back', () => {
  it('quote.js calls initPageSwipe', () => {
    expect(quoteJs).toContain('initPageSwipe(');
  });

  it('article.js calls initPageSwipe', () => {
    expect(articleJs).toContain('initPageSwipe(');
  });

  it('author.js calls initPageSwipe', () => {
    expect(authorJs).toContain('initPageSwipe(');
  });

  it('topic.js calls initPageSwipe', () => {
    expect(topicJs).toContain('initPageSwipe(');
  });

  it('category.js calls initPageSwipe', () => {
    expect(categoryJs).toContain('initPageSwipe(');
  });
});

// ======= Popstate Direction Detection =======

describe('Popstate direction detection (app.js)', () => {
  it('popstate handler detects direction via navIndex', () => {
    expect(appJs).toContain('stateIndex');
    expect(appJs).toContain("'back'");
    expect(appJs).toContain("'forward'");
  });

  it('popstate calls transitionBack for back navigation', () => {
    expect(appJs).toContain('transitionBack');
  });

  it('popstate calls transitionForward for forward navigation', () => {
    expect(appJs).toContain('transitionForward');
  });
});
