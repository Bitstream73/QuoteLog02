import { getDb } from '../config/database.js';

// Common English stopwords to filter out
const STOPWORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'shall', 'can', 'need', 'must',
  'said', 'told', 'says', 'asked', 'added', 'noted', 'stated', 'announced',
  'and', 'but', 'or', 'nor', 'not', 'so', 'yet', 'both', 'either', 'neither',
  'for', 'with', 'from', 'into', 'about', 'against', 'between', 'through',
  'during', 'before', 'after', 'above', 'below', 'under', 'over',
  'this', 'that', 'these', 'those', 'what', 'which', 'who', 'whom', 'whose',
  'when', 'where', 'why', 'how', 'all', 'each', 'every', 'any', 'some',
  'its', 'his', 'her', 'their', 'our', 'your', 'my',
  'very', 'just', 'also', 'more', 'most', 'much', 'many', 'other',
  'than', 'then', 'now', 'here', 'there', 'only', 'even', 'still',
  'too', 'well', 'back', 'way', 'get', 'got', 'make', 'made',
  'like', 'think', 'know', 'see', 'come', 'take', 'want', 'look',
  'use', 'find', 'give', 'tell', 'work', 'call', 'try', 'keep',
  'let', 'begin', 'seem', 'help', 'show', 'hear', 'play', 'run',
  'move', 'live', 'believe', 'bring', 'happen', 'write', 'provide',
  'sit', 'stand', 'lose', 'pay', 'meet', 'include', 'continue',
  'set', 'learn', 'change', 'lead', 'understand', 'watch', 'follow',
  'stop', 'create', 'speak', 'read', 'allow', 'add', 'spend', 'grow',
  'open', 'walk', 'win', 'offer', 'remember', 'love', 'consider',
  'appear', 'buy', 'wait', 'serve', 'die', 'send', 'expect', 'build',
  'stay', 'fall', 'cut', 'reach', 'kill', 'remain', 'suggest', 'raise',
  'pass', 'sell', 'require', 'report', 'decide', 'pull',
  'new', 'old', 'big', 'long', 'great', 'little', 'right', 'good',
  'bad', 'different', 'small', 'large', 'next', 'early', 'young',
  'important', 'few', 'public', 'same', 'able', 'last', 'real', 'own',
  'while', 'because', 'until', 'since', 'though', 'although', 'whether',
  'going', 'thing', 'something', 'nothing', 'everything', 'anything',
  'people', 'time', 'year', 'years', 'day', 'days', 'week', 'month',
  'one', 'two', 'three', 'four', 'five', 'first', 'second', 'third',
  'part', 'case', 'group', 'number', 'world', 'area', 'percent',
  'problem', 'fact', 'point', 'place', 'state', 'country', 'million',
  'billion', 'today', 'according', 'really', 'already', 'around',
  'however', 'often', 'away', 'never', 'always', 'sometimes',
  'dont', 'doesnt', 'didnt', 'wont', 'cant', 'couldnt', 'shouldnt',
  'wouldnt', 'isnt', 'arent', 'wasnt', 'werent', 'hasnt', 'havent',
  'hadnt', 'thats', 'theres', 'heres', 'whats', 'whos', 'wheres',
]);

/**
 * Extract keywords from text. Returns up to maxKeywords lowercase keywords.
 * Filters stopwords, short words, and numbers.
 */
export function extractKeywords(text, maxKeywords = 5) {
  if (!text) return [];

  // Split on whitespace and punctuation, lowercase, filter
  const words = text.toLowerCase()
    .replace(/[^a-z\s'-]/g, ' ')
    .split(/\s+/)
    .map(w => w.replace(/^['-]+|['-]+$/g, ''))
    .filter(w =>
      w.length >= 3 &&
      !STOPWORDS.has(w) &&
      !/^\d+$/.test(w)
    );

  // Count frequency
  const freq = {};
  for (const w of words) {
    freq[w] = (freq[w] || 0) + 1;
  }

  // Sort by frequency, take top N
  return Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxKeywords)
    .map(([word]) => word);
}

/**
 * Extract and store keywords for a quote.
 * Uses the context field primarily, falls back to quote text.
 */
export function indexQuoteKeywords(quoteId, context, text) {
  const db = getDb();
  const source = context || text || '';
  const keywords = extractKeywords(source);

  if (keywords.length === 0 && context && text) {
    // If context yielded nothing, try text
    const textKeywords = extractKeywords(text);
    keywords.push(...textKeywords);
  }

  const upsertKeyword = db.prepare(
    `INSERT INTO keywords (name, name_normalized, keyword_type) VALUES (?, ?, 'concept')
     ON CONFLICT(name) DO NOTHING`
  );
  const getKeyword = db.prepare('SELECT id FROM keywords WHERE name = ?');
  const linkKeyword = db.prepare(
    'INSERT OR IGNORE INTO quote_keywords (quote_id, keyword_id) VALUES (?, ?)'
  );

  for (const keyword of keywords) {
    upsertKeyword.run(keyword, keyword.toLowerCase());
    const row = getKeyword.get(keyword);
    if (row) {
      linkKeyword.run(quoteId, row.id);
    }
  }

  return keywords;
}

/**
 * Backfill keywords for all existing quotes that don't have keywords yet.
 */
export function backfillKeywords() {
  const db = getDb();

  // Find quotes without keywords
  const quotes = db.prepare(`
    SELECT q.id, q.context, q.text
    FROM quotes q
    LEFT JOIN quote_keywords qk ON qk.quote_id = q.id
    WHERE qk.keyword_id IS NULL AND q.is_visible = 1
  `).all();

  let count = 0;
  const upsertKeyword = db.prepare(
    `INSERT INTO keywords (name, name_normalized, keyword_type) VALUES (?, ?, 'concept')
     ON CONFLICT(name) DO NOTHING`
  );
  const getKeyword = db.prepare('SELECT id FROM keywords WHERE name = ?');
  const linkKeyword = db.prepare(
    'INSERT OR IGNORE INTO quote_keywords (quote_id, keyword_id) VALUES (?, ?)'
  );

  for (const q of quotes) {
    const source = q.context || q.text || '';
    const keywords = extractKeywords(source);
    for (const keyword of keywords) {
      upsertKeyword.run(keyword, keyword.toLowerCase());
      const row = getKeyword.get(keyword);
      if (row) {
        linkKeyword.run(q.id, row.id);
      }
    }
    if (keywords.length > 0) count++;
  }

  return count;
}
