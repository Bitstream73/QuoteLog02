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
import config from '../config/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Persistent Disk Cache (L2)
// ---------------------------------------------------------------------------

export const CACHE_DIR = path.join(path.dirname(config.databasePath), 'share-images');
let _cacheDirReady = false;

function ensureCacheDir() {
  if (_cacheDirReady) return;
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  _cacheDirReady = true;
}

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
  // Delete disk cache files (L2)
  for (const fmt of ['landscape', 'portrait']) {
    try { fs.unlinkSync(path.join(CACHE_DIR, `${quoteId}-${fmt}.jpg`)); } catch {}
  }
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
  if (v === 'OPINION') return COLORS.verdictOpinion;
  if (v === 'FRAGMENT') return COLORS.textMuted;
  return COLORS.textMuted;
}

function getVerdictLabel(verdict) {
  if (!verdict) return null;
  const map = {
    TRUE: 'TRUE', MOSTLY_TRUE: 'MOSTLY TRUE',
    FALSE: 'FALSE', MOSTLY_FALSE: 'MOSTLY FALSE',
    MISLEADING: 'MISLEADING', LACKS_CONTEXT: 'LACKS CONTEXT',
    UNVERIFIABLE: 'UNVERIFIABLE',
    OPINION: 'OPINION / SUBJECTIVE',
    FRAGMENT: 'UNVERIFIABLE',
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
// Image Fetch Helper
// ---------------------------------------------------------------------------

async function fetchImageAsDataUri(url) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const resp = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    if (!resp.ok) return null;
    const contentType = resp.headers.get('content-type') || 'image/jpeg';
    const arrayBuffer = await resp.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString('base64');
    return `data:${contentType};base64,${base64}`;
  } catch {
    return null;
  }
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

  const contentChildren = [];

  // Verdict badge at top (centered)
  if (verdictLabel) {
    contentChildren.push({
      type: 'div',
      props: {
        style: {
          display: 'flex',
          justifyContent: 'center',
          marginBottom: 12,
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

  // Quote text (centered, NO flex: 1)
  contentChildren.push({
    type: 'div',
    props: {
      style: {
        display: 'flex',
        flexDirection: 'column',
      },
      children: [
        {
          type: 'div',
          props: {
            style: {
              fontFamily: 'Playfair Display',
              fontSize,
              color: COLORS.text,
              lineHeight: 1.35,
              textAlign: 'center',
            },
            children: `\u201C${quoteText}\u201D`,
          },
        },
      ],
    },
  });

  // Author section — centered avatar + name
  const avatarSize = 80;
  const avatarElement = data.photoDataUri
    ? {
        type: 'img',
        props: {
          src: data.photoDataUri,
          width: avatarSize,
          height: avatarSize,
          style: {
            width: avatarSize,
            height: avatarSize,
            borderRadius: avatarSize / 2,
            objectFit: 'cover',
          },
        },
      }
    : {
        type: 'div',
        props: {
          style: {
            width: avatarSize,
            height: avatarSize,
            borderRadius: avatarSize / 2,
            backgroundColor: COLORS.accent,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontFamily: 'DM Sans',
            fontSize: 34,
            fontWeight: 700,
            color: '#fff',
          },
          children: (data.authorName || '?').charAt(0).toUpperCase(),
        },
      };

  contentChildren.push({
    type: 'div',
    props: {
      style: {
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        marginTop: 14,
        gap: 8,
      },
      children: [
        avatarElement,
        {
          type: 'div',
          props: {
            style: {
              fontFamily: 'Playfair Display',
              fontSize: 24,
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

  // Fact check card (claim + explanation)
  if (verdictLabel && (claimText || explanationText)) {
    const cardChildren = [];

    if (claimText) {
      cardChildren.push({
        type: 'div',
        props: {
          style: {
            fontFamily: 'DM Sans',
            fontSize: 14,
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
            fontSize: 13,
            fontStyle: 'italic',
            color: COLORS.textMuted,
            marginTop: 6,
            lineHeight: 1.4,
          },
          children: explanationText,
        },
      });
    }

    contentChildren.push({
      type: 'div',
      props: {
        style: {
          display: 'flex',
          flexDirection: 'column',
          marginTop: 16,
          padding: '12px 16px',
          backgroundColor: COLORS.bgCard,
          borderRadius: 6,
          borderLeft: `3px solid ${verdictColor}`,
        },
        children: cardChildren,
      },
    });
  }

  // Branding (centered with content)
  contentChildren.push({
    type: 'div',
    props: {
      style: {
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        marginTop: 18,
        gap: 4,
      },
      children: [
        {
          type: 'div',
          props: {
            style: {
              fontFamily: 'Playfair Display',
              fontSize: 24,
              fontWeight: 700,
              color: '#FFFFFF',
            },
            children: 'TrueOrFalse.News',
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
            children: 'What they said - Fact Checked',
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
        padding: '30px 50px',
        fontFamily: 'DM Sans',
      },
      children: [
        // Content wrapper: centers everything as a group
        {
          type: 'div',
          props: {
            style: {
              display: 'flex',
              flexDirection: 'column',
              flex: 1,
              justifyContent: 'center',
            },
            children: contentChildren,
          },
        },
      ],
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

  // Content items (badge + quote + author + fact check) — centered as a group
  const contentChildren = [];

  // Verdict badge at top (standalone, centered)
  if (verdictLabel) {
    contentChildren.push({
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

  // Quote text (NO flex: 1)
  contentChildren.push({
    type: 'div',
    props: {
      style: {
        display: 'flex',
        flexDirection: 'column',
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

  // Author section — 100px photo circle or initial fallback
  const avatarElement = data.photoDataUri
    ? {
        type: 'img',
        props: {
          src: data.photoDataUri,
          width: 100,
          height: 100,
          style: {
            width: 100,
            height: 100,
            borderRadius: 50,
            objectFit: 'cover',
          },
        },
      }
    : {
        type: 'div',
        props: {
          style: {
            width: 100,
            height: 100,
            borderRadius: 50,
            backgroundColor: COLORS.accent,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontFamily: 'DM Sans',
            fontSize: 42,
            fontWeight: 700,
            color: '#fff',
          },
          children: (data.authorName || '?').charAt(0).toUpperCase(),
        },
      };

  contentChildren.push({
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
        avatarElement,
        {
          type: 'div',
          props: {
            style: {
              fontFamily: 'Playfair Display',
              fontSize: 24,
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

    contentChildren.push({
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

  // Branding (centered with content)
  contentChildren.push({
    type: 'div',
    props: {
      style: {
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        marginTop: 24,
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
              color: '#FFFFFF',
            },
            children: 'TrueOrFalse.News',
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
            children: 'What they said - Fact Checked',
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
      children: [
        // Content wrapper: centers everything as a group
        {
          type: 'div',
          props: {
            style: {
              display: 'flex',
              flexDirection: 'column',
              flex: 1,
              justifyContent: 'center',
            },
            children: contentChildren,
          },
        },
      ],
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
 * @param {string} [quoteData.photoUrl]      — author photo URL
 * @param {string} [quoteData.claim]
 * @param {string} [quoteData.explanation]
 * @param {string} format — 'landscape' (1200×630) or 'portrait' (600×900)
 * @returns {Promise<Buffer>} JPEG buffer
 */
export async function generateShareImage(quoteData, format = 'landscape') {
  if (!fontsLoaded) await loadFonts();

  // Check L1 in-memory cache
  if (quoteData.quoteId) {
    const cacheKey = getCacheKey(quoteData.quoteId, format);
    const cached = imageCache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp < CACHE_TTL_MS)) {
      return cached.buffer;
    }

    // Check L2 disk cache
    const diskPath = path.join(CACHE_DIR, `${quoteData.quoteId}-${format}.jpg`);
    try {
      const diskBuffer = fs.readFileSync(diskPath);
      // Promote back to L1
      imageCache.set(cacheKey, { buffer: diskBuffer, timestamp: Date.now() });
      return diskBuffer;
    } catch { /* not on disk, generate fresh */ }
  }

  const isPortrait = format === 'portrait';
  const width = isPortrait ? 600 : 1200;
  const height = isPortrait ? 900 : 630;

  // Fetch author photo
  let photoDataUri = null;
  if (quoteData.photoUrl) {
    photoDataUri = await fetchImageAsDataUri(quoteData.photoUrl);
  }

  const layoutData = { ...quoteData, photoDataUri };
  const buildLayout = isPortrait ? buildPortraitLayout : buildLandscapeLayout;

  const element = buildLayout(layoutData);

  // satori → SVG (retry without photo if it fails)
  let svg;
  try {
    svg = await satori(element, { width, height, fonts: fontData });
  } catch (err) {
    if (photoDataUri) {
      layoutData.photoDataUri = null;
      const fallbackElement = buildLayout(layoutData);
      svg = await satori(fallbackElement, { width, height, fonts: fontData });
    } else {
      throw err;
    }
  }

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

  // Store in L1 memory cache
  if (quoteData.quoteId) {
    imageCache.set(getCacheKey(quoteData.quoteId, format), {
      buffer: jpegBuffer,
      timestamp: Date.now(),
    });
    pruneCache();

    // Write to L2 disk cache
    try {
      ensureCacheDir();
      fs.writeFileSync(path.join(CACHE_DIR, `${quoteData.quoteId}-${format}.jpg`), jpegBuffer);
    } catch (err) { /* log but don't fail */ }
  }

  return jpegBuffer;
}
