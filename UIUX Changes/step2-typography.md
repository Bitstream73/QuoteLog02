# Step 2: Typography + Spacing + Visual Hierarchy

## Goal
CSS-only changes that elevate the perceived quality. Wider layout, newspaper-style dividers, and more prominent quote typography create an editorial feel matching NYT/Guardian.

## Files to Modify
- `public/css/styles.css`

---

## 2.1 Widen Max-Width

**File**: `public/css/styles.css`
**Location**: `:root` block, line 30

```css
/* Change from: */
--max-width: 960px;

/* Change to: */
--max-width: 1080px;
```

This gives more breathing room without going full-width, matching the reading-width sweet spot of broadsheet newspapers.

---

## 2.2 Fluid Page Title

**File**: `public/css/styles.css`
**Location**: Find the `.page-title` rule

Update the font-size to use `clamp()` for responsive scaling, and add `text-wrap: balance` for more elegant line breaks:

```css
.page-title {
  font-family: var(--font-headline);
  font-size: clamp(2rem, 5vw, 3rem);
  font-weight: 900;
  letter-spacing: -0.02em;
  text-wrap: balance;
  /* ...keep existing properties... */
}
```

---

## 2.3 Newspaper-Style Section Dividers

**File**: `public/css/styles.css`
**Location**: Add near the utility/general styles section

Add reusable section divider classes following NYT conventions (double lines for major sections, single lines for sub-sections):

```css
.section-rule {
  border: none;
  border-top: 1px solid var(--border);
  margin: 2rem 0;
}

.section-rule-double {
  border: none;
  border-top: 3px double var(--border-dark);
  margin: 2rem 0;
}
```

---

## 2.4 Article Group Separation

**File**: `public/css/styles.css`
**Location**: Find the `.article-group` rule (currently has `border: none`)

Add bottom borders between article groups for clearer visual separation:

```css
.article-group {
  /* ...keep existing styles... */
  margin-bottom: 0;
  padding-bottom: 1.5rem;
  border-bottom: 1px solid var(--border);
}

.article-group:last-child {
  border-bottom: none;
}
```

---

## 2.5 Elevated Quote Decorators

**File**: `public/css/styles.css`
**Location**: Find the `.quote-text::before` and `.quote-text::after` rules

Make the opening curly quote into a larger, more prominent decorative element (pull-quote style):

```css
.quote-text::before {
  content: '\201C';
  color: var(--accent);
  font-family: var(--font-headline);
  font-size: 2.5rem;
  font-weight: 900;
  line-height: 0;
  vertical-align: -0.3em;
  margin-right: 0.05em;
}

.quote-text::after {
  content: '\201D';
  color: var(--accent);
  font-size: 1.4rem;
  font-weight: bold;
}
```

---

## Verification

1. Layout is visibly wider (1080px vs 960px) — more breathing room on desktop
2. Page titles scale fluidly from ~2rem on mobile to 3rem on desktop
3. Article groups have clear 1px borders separating them (no border on last group)
4. Opening curly quote is large and prominent (2.5rem) — feels like a newspaper pull-quote
5. Check in both light and dark mode — dividers and borders use themed variables

## Commit Message
```
style: refine typography, spacing, and visual hierarchy for editorial feel
```
