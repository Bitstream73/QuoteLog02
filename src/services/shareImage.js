/**
 * shareImage.js — Generates branded share card images for quotes.
 *
 * Pipeline: satori (JSX-like → SVG) → resvg (SVG → PNG) → sharp (PNG → JPG)
 *
 * Two formats:
 *   - landscape (1200×630) — for OG meta tags / link previews
 *   - portrait  (600×900)  — for download & native sharing
 */

import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';
import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Font Loading
// ---------------------------------------------------------------------------

let fontsLoaded = false;
let fontData = [];

export async function loadFonts() {
  if (fontsLoaded) return;

  const fontsDir = path.join(__dirname, '../assets/fonts');

  const playfairRegular = fs.readFileSync(path.join(fontsDir, 'PlayfairDisplay-Regular.ttf'));
  const playfairItalic = fs.readFileSync(path.join(fontsDir, 'PlayfairDisplay-Italic.ttf'));
  const dmSansRegular = fs.readFileSync(path.join(fontsDir, 'DMSans-Regular.ttf'));

  fontData = [
    { name: 'Playfair Display', data: playfairRegular, weight: 400, style: 'normal' },
    { name: 'Playfair Display', data: playfairRegular, weight: 700, style: 'normal' },
    { name: 'Playfair Display', data: playfairItalic, weight: 400, style: 'italic' },
    { name: 'DM Sans', data: dmSansRegular, weight: 400, style: 'normal' },
    { name: 'DM Sans', data: dmSansRegular, weight: 700, style: 'normal' },
  ];

  fontsLoaded = true;
}

// ---------------------------------------------------------------------------
// Cache (LRU-style, 1-hour TTL, max 400 entries)
// ---------------------------------------------------------------------------

const imageCache = new Map();
const CACHE_TTL_MS = 60 * 60 * 1000;
const CACHE_MAX = 400;

function getCacheKey(quoteId, format) {
  return `${quoteId}:${format}`;
}

function pruneCache() {
  if (imageCache.size <= CACHE_MAX) return;
  const now = Date.now();
  for (const [key, entry] of imageCache) {
    if (now - entry.timestamp > CACHE_TTL_MS || imageCache.size > CACHE_MAX) {
      imageCache.delete(key);
    }
  }
}

export function invalidateShareImageCache(quoteId) {
  imageCache.delete(getCacheKey(quoteId, 'landscape'));
  imageCache.delete(getCacheKey(quoteId, 'portrait'));
}

// ---------------------------------------------------------------------------
// Theme Constants
// ---------------------------------------------------------------------------

const COLORS = {
  bg: '#0D0D14',
  bgCard: '#1A1A2E',
  text: '#E8E6E3',
  textMuted: '#8B8A87',
  accent: '#c41e3a',
  brandGold: '#D4AF37',
  verdictTrue: '#16a34a',
  verdictFalse: '#c41e3a',
  verdictMisleading: '#d4880f',
  verdictOpinion: '#6B7280',
  verdictUnverifiable: '#2563eb',
};

function getVerdictColor(verdict) {
  if (!verdict) return COLORS.textMuted;
  const v = verdict.toUpperCase();
  if (v === 'TRUE' || v === 'MOSTLY_TRUE') return COLORS.verdictTrue;
  if (v === 'FALSE' || v === 'MOSTLY_FALSE') return COLORS.verdictFalse;
  if (v === 'MISLEADING' || v === 'LACKS_CONTEXT') return COLORS.verdictMisleading;
  if (v === 'UNVERIFIABLE') return COLORS.verdictUnverifiable;
  return COLORS.textMuted;
}

function getVerdictLabel(verdict) {
  if (!verdict) return null;
  const map = {
    TRUE: 'TRUE', MOSTLY_TRUE: 'MOSTLY TRUE',
    FALSE: 'FALSE', MOSTLY_FALSE: 'MOSTLY FALSE',
    MISLEADING: 'MISLEADING', LACKS_CONTEXT: 'LACKS CONTEXT',
    UNVERIFIABLE: 'UNVERIFIABLE',
  };
  return map[verdict.toUpperCase()] || verdict;
}

function getCategoryLabel(category) {
  if (category === 'B') return 'OPINION';
  if (category === 'C') return 'UNVERIFIABLE';
  return null;
}

function getCategoryColor(category) {
  if (category === 'B') return COLORS.verdictOpinion;
  if (category === 'C') return COLORS.textMuted;
  return COLORS.textMuted;
}

// ---------------------------------------------------------------------------
// Text Helpers
// ---------------------------------------------------------------------------

function truncate(text, maxLen) {
  if (!text) return '';
  if (text.length <= maxLen) return text;
  return text.substring(0, maxLen - 1).replace(/\s+\S*$/, '') + '\u2026';
}

function getQuoteFontSize(text, format) {
  const len = text.length;
  if (format === 'portrait') {
    if (len < 100) return 28;
    if (len < 200) return 24;
    if (len < 300) return 20;
    return 18;
  }
  // landscape — must be large enough to read when Facebook scales down the 1200×630 image
  if (len < 80) return 42;
  if (len < 150) return 36;
  if (len < 250) return 30;
  return 26;
}

// ---------------------------------------------------------------------------
// Layout Builders (satori element trees)
// ---------------------------------------------------------------------------

function buildLandscapeLayout(data) {
  const quoteText = truncate(data.quoteText, 220);
  const fontSize = getQuoteFontSize(quoteText, 'landscape');

  const verdictLabel = data.verdict ? getVerdictLabel(data.verdict) : getCategoryLabel(data.category);
  const verdictColor = data.verdict ? getVerdictColor(data.verdict) : getCategoryColor(data.category);
  const claimText = truncate(data.claim || '', 120);
  const explanationText = truncate(data.explanation || '', 180);

  const children = [];

  // Quote text
  children.push({
    type: 'div',
    props: {
      style: {
        display: 'flex',
        flexDirection: 'column',
        flex: 1,
        justifyContent: 'center',
        padding: '0',
      },
      children: [
        {
          type: 'div',
          props: {
            style: {
              fontFamily: 'Playfair Display',
              fontSize: 64,
              color: COLORS.brandGold,
              marginBottom: -16,
              lineHeight: 1,
            },
            children: '\u201C',
          },
        },
        {
          type: 'div',
          props: {
            style: {
              fontFamily: 'Playfair Display',
              fontSize,
              color: COLORS.text,
              lineHeight: 1.35,
            },
            children: quoteText,
          },
        },
      ],
    },
  });

  // Author row
  children.push({
    type: 'div',
    props: {
      style: {
        display: 'flex',
        alignItems: 'center',
        marginTop: 20,
        gap: 14,
      },
      children: [
        // Avatar circle
        {
          type: 'div',
          props: {
            style: {
              width: 48,
              height: 48,
              borderRadius: 24,
              backgroundColor: COLORS.accent,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontFamily: 'DM Sans',
              fontSize: 22,
              fontWeight: 700,
              color: '#fff',
              flexShrink: 0,
            },
            children: (data.authorName || '?').charAt(0).toUpperCase(),
          },
        },
        {
          type: 'div',
          props: {
            style: { display: 'flex', flexDirection: 'column' },
            children: [
              {
                type: 'div',
                props: {
                  style: {
                    fontFamily: 'DM Sans',
                    fontSize: 22,
                    fontWeight: 700,
                    color: COLORS.text,
                  },
                  children: data.authorName || 'Unknown',
                },
              },
              ...(data.disambiguation ? [{
                type: 'div',
                props: {
                  style: {
                    fontFamily: 'DM Sans',
                    fontSize: 17,
                    color: COLORS.textMuted,
                  },
                  children: truncate(data.disambiguation, 60),
                },
              }] : []),
            ],
          },
        },
      ],
    },
  });

  // Verdict / category badge section
  if (verdictLabel) {
    const verdictChildren = [
      {
        type: 'div',
        props: {
          style: {
            display: 'flex',
            alignItems: 'center',
            gap: 10,
          },
          children: [
            {
              type: 'div',
              props: {
                style: {
                  backgroundColor: verdictColor,
                  color: '#fff',
                  fontFamily: 'DM Sans',
                  fontSize: 16,
                  fontWeight: 700,
                  padding: '5px 12px',
                  borderRadius: 4,
                  letterSpacing: 0.5,
                },
                children: verdictLabel,
              },
            },
            ...(claimText ? [{
              type: 'div',
              props: {
                style: {
                  fontFamily: 'DM Sans',
                  fontSize: 17,
                  color: COLORS.text,
                  fontWeight: 700,
                },
                children: claimText,
              },
            }] : []),
          ],
        },
      },
    ];

    if (explanationText) {
      verdictChildren.push({
        type: 'div',
        props: {
          style: {
            fontFamily: 'DM Sans',
            fontSize: 15,
            fontStyle: 'italic',
            color: COLORS.textMuted,
            marginTop: 6,
            lineHeight: 1.4,
          },
          children: explanationText,
        },
      });
    }

    children.push({
      type: 'div',
      props: {
        style: {
          display: 'flex',
          flexDirection: 'column',
          marginTop: 18,
          padding: '14px 18px',
          backgroundColor: COLORS.bgCard,
          borderRadius: 6,
          borderLeft: `3px solid ${verdictColor}`,
        },
        children: verdictChildren,
      },
    });
  }

  // Branding footer
  children.push({
    type: 'div',
    props: {
      style: {
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginTop: 'auto',
        paddingTop: 16,
      },
      children: [
        {
          type: 'div',
          props: {
            style: {
              fontFamily: 'Playfair Display',
              fontSize: 22,
              fontWeight: 700,
              color: COLORS.brandGold,
            },
            children: 'WhatTheySaid.News',
          },
        },
        {
          type: 'div',
          props: {
            style: {
              fontFamily: 'DM Sans',
              fontSize: 16,
              color: COLORS.textMuted,
              fontStyle: 'italic',
            },
            children: 'Accountability Through Quotes',
          },
        },
      ],
    },
  });

  return {
    type: 'div',
    props: {
      style: {
        display: 'flex',
        flexDirection: 'column',
        width: 1200,
        height: 630,
        backgroundColor: COLORS.bg,
        padding: '40px 50px',
        fontFamily: 'DM Sans',
      },
      children,
    },
  };
}

function buildPortraitLayout(data) {
  const quoteText = truncate(data.quoteText, 350);
  const fontSize = getQuoteFontSize(quoteText, 'portrait');

  const verdictLabel = data.verdict ? getVerdictLabel(data.verdict) : getCategoryLabel(data.category);
  const verdictColor = data.verdict ? getVerdictColor(data.verdict) : getCategoryColor(data.category);
  const claimText = truncate(data.claim || '', 100);
  const explanationText = truncate(data.explanation || '', 180);

  const children = [];

  // Verdict badge at top (standalone, centered)
  if (verdictLabel) {
    children.push({
      type: 'div',
      props: {
        style: {
          display: 'flex',
          justifyContent: 'center',
          marginBottom: 16,
        },
        children: [
          {
            type: 'div',
            props: {
              style: {
                backgroundColor: verdictColor,
                color: '#fff',
                fontFamily: 'DM Sans',
                fontSize: 14,
                fontWeight: 700,
                padding: '6px 18px',
                borderRadius: 4,
                letterSpacing: 1,
              },
              children: verdictLabel,
            },
          },
        ],
      },
    });
  }

  // Quote text
  children.push({
    type: 'div',
    props: {
      style: {
        display: 'flex',
        flexDirection: 'column',
        flex: 1,
        justifyContent: 'center',
      },
      children: [
        {
          type: 'div',
          props: {
            style: {
              fontFamily: 'Playfair Display',
              fontSize,
              color: COLORS.text,
              lineHeight: 1.4,
              textAlign: 'center',
            },
            children: `\u201C${quoteText}\u201D`,
          },
        },
      ],
    },
  });

  // Author section (centered, larger name)
  children.push({
    type: 'div',
    props: {
      style: {
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        marginTop: 16,
        gap: 10,
      },
      children: [
        {
          type: 'div',
          props: {
            style: {
              width: 60,
              height: 60,
              borderRadius: 30,
              backgroundColor: COLORS.accent,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontFamily: 'DM Sans',
              fontSize: 26,
              fontWeight: 700,
              color: '#fff',
            },
            children: (data.authorName || '?').charAt(0).toUpperCase(),
          },
        },
        {
          type: 'div',
          props: {
            style: {
              fontFamily: 'Playfair Display',
              fontSize: 22,
              fontWeight: 700,
              color: COLORS.text,
              textAlign: 'center',
            },
            children: data.authorName || 'Unknown',
          },
        },
      ],
    },
  });

  // Fact check card (claim + explanation only, no badge inside)
  if (verdictLabel && (claimText || explanationText)) {
    const cardChildren = [];

    if (claimText) {
      cardChildren.push({
        type: 'div',
        props: {
          style: {
            fontFamily: 'DM Sans',
            fontSize: 13,
            fontWeight: 700,
            color: COLORS.text,
          },
          children: claimText,
        },
      });
    }

    if (explanationText) {
      cardChildren.push({
        type: 'div',
        props: {
          style: {
            fontFamily: 'DM Sans',
            fontSize: 12,
            fontStyle: 'italic',
            color: COLORS.textMuted,
            marginTop: 6,
            lineHeight: 1.4,
          },
          children: explanationText,
        },
      });
    }

    children.push({
      type: 'div',
      props: {
        style: {
          display: 'flex',
          flexDirection: 'column',
          marginTop: 20,
          padding: '14px 16px',
          backgroundColor: COLORS.bgCard,
          borderRadius: 6,
          borderLeft: `3px solid ${verdictColor}`,
        },
        children: cardChildren,
      },
    });
  }

  // Branding footer (larger)
  children.push({
    type: 'div',
    props: {
      style: {
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        marginTop: 'auto',
        paddingTop: 24,
        gap: 4,
      },
      children: [
        {
          type: 'div',
          props: {
            style: {
              fontFamily: 'Playfair Display',
              fontSize: 28,
              fontWeight: 700,
              color: COLORS.brandGold,
            },
            children: 'WhatTheySaid.News',
          },
        },
        {
          type: 'div',
          props: {
            style: {
              fontFamily: 'DM Sans',
              fontSize: 14,
              color: COLORS.textMuted,
              fontStyle: 'italic',
            },
            children: 'Accountability Through Quotes',
          },
        },
      ],
    },
  });

  return {
    type: 'div',
    props: {
      style: {
        display: 'flex',
        flexDirection: 'column',
        width: 600,
        height: 900,
        backgroundColor: COLORS.bg,
        padding: '40px 36px',
        fontFamily: 'DM Sans',
      },
      children,
    },
  };
}

// ---------------------------------------------------------------------------
// Main Generation Function
// ---------------------------------------------------------------------------

/**
 * Generate a share image for a quote.
 *
 * @param {Object} quoteData
 * @param {string} quoteData.quoteText
 * @param {string} quoteData.authorName
 * @param {string} [quoteData.disambiguation]
 * @param {string} [quoteData.verdict]       — e.g. 'TRUE', 'FALSE', 'MISLEADING'
 * @param {string} [quoteData.category]      — 'A', 'B', or 'C'
 * @param {string} [quoteData.claim]
 * @param {string} [quoteData.explanation]
 * @param {string} format — 'landscape' (1200×630) or 'portrait' (600×900)
 * @returns {Promise<Buffer>} JPEG buffer
 */
export async function generateShareImage(quoteData, format = 'landscape') {
  if (!fontsLoaded) await loadFonts();

  // Check cache
  if (quoteData.quoteId) {
    const cacheKey = getCacheKey(quoteData.quoteId, format);
    const cached = imageCache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp < CACHE_TTL_MS)) {
      return cached.buffer;
    }
  }

  const isPortrait = format === 'portrait';
  const width = isPortrait ? 600 : 1200;
  const height = isPortrait ? 900 : 630;

  const element = isPortrait
    ? buildPortraitLayout(quoteData)
    : buildLandscapeLayout(quoteData);

  // satori → SVG
  const svg = await satori(element, {
    width,
    height,
    fonts: fontData,
  });

  // resvg → PNG
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: width },
  });
  const pngData = resvg.render();
  const pngBuffer = pngData.asPng();

  // sharp → JPG
  const jpegBuffer = await sharp(pngBuffer)
    .jpeg({ quality: 85 })
    .toBuffer();

  // Store in cache
  if (quoteData.quoteId) {
    imageCache.set(getCacheKey(quoteData.quoteId, format), {
      buffer: jpegBuffer,
      timestamp: Date.now(),
    });
    pruneCache();
  }

  return jpegBuffer;
}
