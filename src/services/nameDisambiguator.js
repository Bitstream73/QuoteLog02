import doubleMetaphone from 'double-metaphone';
import { distance as jaroWinkler } from 'jaro-winkler';
import { GoogleGenerativeAI } from '@google/generative-ai';
import config from '../config/index.js';
import { getDb, getSettingValue } from '../config/database.js';
import logger from './logger.js';

// Title prefixes to strip
const TITLES = /^(Mr\.?|Mrs\.?|Ms\.?|Dr\.?|Prof\.?|Sen\.?|Rep\.?|Gov\.?|Pres\.?|President|Senator|Representative|Governor|Judge|Justice|Chief|Sir|Dame|Lord|Lady|Gen\.?|General|Adm\.?|Admiral|Col\.?|Colonel|Maj\.?|Major|Capt\.?|Captain|Rev\.?|Reverend|Father|Brother|Sister|Rabbi|Imam|Sheikh)\s+/i;
const SUFFIXES = /,?\s+(Jr\.?|Sr\.?|III?|IV|V|Esq\.?|Ph\.?D\.?|M\.?D\.?|DDS|RN|CPA)$/i;

// Common name variants
const NAME_VARIANTS = {
  'william': ['will', 'bill', 'billy', 'willy', 'liam'],
  'robert': ['rob', 'bob', 'bobby', 'robbie', 'bert'],
  'james': ['jim', 'jimmy', 'jamie'],
  'john': ['johnny', 'jon', 'jack'],
  'elizabeth': ['liz', 'lizzy', 'beth', 'betty', 'eliza'],
  'margaret': ['maggie', 'meg', 'peggy', 'marge'],
  'richard': ['rick', 'rich', 'dick', 'ricky'],
  'michael': ['mike', 'mikey', 'mick'],
  'thomas': ['tom', 'tommy'],
  'christopher': ['chris', 'kit'],
  'jennifer': ['jen', 'jenny'],
  'katherine': ['kate', 'kathy', 'kat', 'katie', 'catherine'],
  'joseph': ['joe', 'joey'],
  'benjamin': ['ben', 'benny'],
  'daniel': ['dan', 'danny'],
  'matthew': ['matt', 'matty'],
  'alexander': ['alex', 'xander'],
  'nicholas': ['nick', 'nicky'],
  'anthony': ['tony'],
  'donald': ['don', 'donny'],
  'edward': ['ed', 'eddie', 'ted', 'teddy'],
  'charles': ['charlie', 'chuck'],
  'timothy': ['tim', 'timmy'],
  'patrick': ['pat', 'paddy'],
  'steven': ['steve'],
  'stephen': ['steve'],
  'andrew': ['andy', 'drew'],
  'joshua': ['josh'],
  'david': ['dave', 'davy'],
  'samuel': ['sam', 'sammy'],
  'jonathan': ['jon', 'jonny'],
  'peter': ['pete'],
  'gregory': ['greg'],
  'raymond': ['ray'],
  'lawrence': ['larry'],
  'gerald': ['jerry', 'gerry'],
  'ronald': ['ron', 'ronnie'],
  'kenneth': ['ken', 'kenny'],
  'harold': ['harry', 'hal'],
  'henry': ['hank', 'harry'],
  'albert': ['al', 'bert'],
  'walter': ['walt', 'wally'],
  'arthur': ['art'],
  'frederick': ['fred', 'freddy', 'rick'],
};

// Build reverse lookup
const NICKNAME_TO_CANONICAL = {};
for (const [canonical, variants] of Object.entries(NAME_VARIANTS)) {
  for (const v of variants) {
    if (!NICKNAME_TO_CANONICAL[v]) NICKNAME_TO_CANONICAL[v] = [];
    NICKNAME_TO_CANONICAL[v].push(canonical);
  }
  if (!NICKNAME_TO_CANONICAL[canonical]) NICKNAME_TO_CANONICAL[canonical] = [];
  NICKNAME_TO_CANONICAL[canonical].push(canonical);
}

/**
 * Normalize a name for comparison
 */
export function normalizeName(name) {
  let n = name.trim();
  n = n.replace(TITLES, '');
  n = n.replace(SUFFIXES, '');
  n = n.replace(/\s+/g, ' ').trim();
  return n.toLowerCase();
}

/**
 * Split a name into first, middle, last parts
 */
function splitNameParts(normalizedName) {
  const parts = normalizedName.split(/\s+/);
  if (parts.length === 1) return { first: '', last: parts[0] };
  return {
    first: parts[0],
    middle: parts.length > 2 ? parts.slice(1, -1).join(' ') : '',
    last: parts[parts.length - 1],
  };
}

/**
 * Check if two first names are compatible (variants, initials, etc.)
 */
function areFirstNamesCompatible(name1, name2) {
  if (name1 === name2) return true;
  if (!name1 || !name2) return true; // One is empty

  // Check if one is an initial of the other
  if (name1.length === 1 && name2.startsWith(name1)) return true;
  if (name2.length === 1 && name1.startsWith(name2)) return true;
  if (name1.endsWith('.') && name1.length === 2 && name2.startsWith(name1[0])) return true;
  if (name2.endsWith('.') && name2.length === 2 && name1.startsWith(name2[0])) return true;

  // Check variant database
  const variants1 = NICKNAME_TO_CANONICAL[name1] || [name1];
  const variants2 = NICKNAME_TO_CANONICAL[name2] || [name2];
  return variants1.some(v => variants2.includes(v));
}

/**
 * Get metaphone codes for a name
 */
function getMetaphoneCodes(name) {
  const codes = doubleMetaphone(name);
  return codes.filter(c => c); // Remove empty codes
}

/**
 * Compute confidence score from match signals
 */
function computeMatchConfidence(signals) {
  let confidence = signals.nameScore || 0;

  if (signals.exactAliasMatch) return 1.0;
  if (signals.nicknameMatch) confidence = Math.max(confidence, 0.8);
  if (signals.abbreviationMatch) confidence = Math.max(confidence, 0.7);
  if (signals.orgOverlap) confidence = Math.min(confidence + 0.15, 1.0);
  if (signals.titleMatch) confidence = Math.min(confidence + 0.10, 1.0);
  if (signals.topicOverlap) confidence = Math.min(confidence + 0.05, 1.0);
  if (signals.llmVerdict === 'same') confidence = Math.min(confidence + 0.2, 1.0);
  if (signals.llmVerdict === 'different') confidence = Math.max(confidence - 0.3, 0.0);

  return confidence;
}

/**
 * Run LLM disambiguation for ambiguous cases
 */
async function llmDisambiguate(newName, newContext, candidates, articleSource) {
  if (!config.geminiApiKey || candidates.length === 0) {
    return { best_match: null, confidence: 0, is_new_person: true };
  }

  const genAI = new GoogleGenerativeAI(config.geminiApiKey);
  const model = genAI.getGenerativeModel({
    model: 'gemini-2.5-flash',
    generationConfig: {
      responseMimeType: 'application/json',
      temperature: 0.1,
    },
  });

  const prompt = `You are a name disambiguation system for news articles.

A new name has been extracted from a news article. Determine if it refers to an existing person in our database.

New name: "${newName}"
New context: "${newContext || 'No context available'}"
Article source: ${articleSource || 'Unknown'}

Existing candidates:
${candidates.map((c, i) => `
${i + 1}. "${c.canonical_name}" (${c.disambiguation || 'no description'})
   Known aliases: ${c.aliases?.join(', ') || 'none'}
   Recent topics: ${c.recentTopics || 'unknown'}
   Organizations: ${c.organizations || 'unknown'}
`).join('')}

For each candidate, assess if the new name refers to that person.
Consider: name similarity, nicknames, abbreviations, shared context, and any disambiguating details.

Return JSON:
{
  "best_match": null or candidate_number (1-indexed),
  "confidence": 0.0 to 1.0,
  "reasoning": "brief explanation",
  "is_new_person": true or false
}

If no candidate is a good match, set best_match to null and is_new_person to true.
If ambiguous between candidates, set confidence below 0.7 and explain why.`;

  try {
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();
    return JSON.parse(text);
  } catch (err) {
    logger.error('disambiguator', 'llm_failed', { error: err.message });
    return { best_match: null, confidence: 0, is_new_person: true };
  }
}

/**
 * Main disambiguation pipeline
 */
export async function resolvePersonId(speakerName, speakerTitle, context, article, db) {
  const normalized = normalizeName(speakerName);
  const nameParts = splitNameParts(normalized);

  // Step 1: Exact alias lookup
  const exactMatch = db.prepare(
    'SELECT person_id, confidence FROM person_aliases WHERE alias_normalized = ? ORDER BY confidence DESC LIMIT 1'
  ).get(normalized);

  if (exactMatch && exactMatch.confidence >= 0.9) {
    logger.debug('disambiguator', 'exact_match', { name: speakerName, personId: exactMatch.person_id });
    return exactMatch.person_id;
  }

  // Step 2: Nickname + last name lookup
  const lastNameMatches = db.prepare(`
    SELECT DISTINCT pa.person_id, pa.alias, pa.alias_normalized, p.canonical_name
    FROM person_aliases pa
    JOIN persons p ON pa.person_id = p.id
    WHERE pa.alias_normalized LIKE ?
  `).all(`%${nameParts.last}`);

  const nicknameMatches = lastNameMatches.filter(m => {
    const mParts = splitNameParts(m.alias_normalized);
    return areFirstNamesCompatible(nameParts.first, mParts.first);
  });

  if (nicknameMatches.length === 1) {
    logger.debug('disambiguator', 'nickname_match', {
      name: speakerName,
      personId: nicknameMatches[0].person_id,
    });
    return nicknameMatches[0].person_id;
  }

  // Step 3: Phonetic + fuzzy matching
  const metaphoneCodes = getMetaphoneCodes(nameParts.last);
  let phoneticMatches = [];

  if (metaphoneCodes.length > 0) {
    const placeholders = metaphoneCodes.map(() => '?').join(',');
    phoneticMatches = db.prepare(`
      SELECT DISTINCT pp.person_id, p.canonical_name
      FROM person_phonetics pp
      JOIN persons p ON pp.person_id = p.id
      WHERE pp.metaphone_code IN (${placeholders}) AND pp.part_type = 'last'
    `).all(...metaphoneCodes);
  }

  // Compute Jaro-Winkler similarity for phonetic matches
  const scoredCandidates = phoneticMatches.map(m => {
    const score = jaroWinkler(normalized, normalizeName(m.canonical_name));
    return { ...m, score };
  }).filter(m => m.score > 0.85);

  if (scoredCandidates.length === 1) {
    logger.debug('disambiguator', 'phonetic_match', {
      name: speakerName,
      personId: scoredCandidates[0].person_id,
      score: scoredCandidates[0].score,
    });
    return scoredCandidates[0].person_id;
  }

  // Step 4: If multiple candidates, try LLM disambiguation
  const autoMergeThreshold = parseFloat(getSettingValue('auto_merge_confidence_threshold', '0.9'));
  const reviewThreshold = parseFloat(getSettingValue('review_confidence_threshold', '0.7'));

  if (scoredCandidates.length > 0 || nicknameMatches.length > 1) {
    const allCandidates = [...new Map(
      [...scoredCandidates, ...nicknameMatches].map(c => [c.person_id, c])
    ).values()];

    // Enrich candidates with additional info
    const enrichedCandidates = allCandidates.map(c => {
      const person = db.prepare('SELECT * FROM persons WHERE id = ?').get(c.person_id);
      const aliases = db.prepare('SELECT alias FROM person_aliases WHERE person_id = ?')
        .all(c.person_id).map(a => a.alias);
      const metadata = person?.metadata ? JSON.parse(person.metadata) : {};

      return {
        ...c,
        canonical_name: person?.canonical_name,
        disambiguation: person?.disambiguation,
        aliases,
        organizations: metadata.organizations?.join(', ') || '',
        recentTopics: metadata.topics?.slice(0, 3).join(', ') || '',
      };
    });

    const llmResult = await llmDisambiguate(
      speakerName,
      context || speakerTitle,
      enrichedCandidates,
      article.domain
    );

    if (llmResult.best_match && llmResult.confidence >= autoMergeThreshold) {
      const matched = enrichedCandidates[llmResult.best_match - 1];
      logger.debug('disambiguator', 'llm_auto_merge', {
        name: speakerName,
        personId: matched.person_id,
        confidence: llmResult.confidence,
      });
      return matched.person_id;
    }

    // Add to review queue if confidence is in review range
    if (llmResult.best_match && llmResult.confidence >= reviewThreshold) {
      const matched = enrichedCandidates[llmResult.best_match - 1];

      // Create person first (will be reassigned if merged)
      const newPersonId = createNewPerson(speakerName, speakerTitle, nameParts, db);

      db.prepare(`INSERT INTO disambiguation_queue
        (new_name, new_name_normalized, new_context, candidate_person_id, candidate_name,
         similarity_score, match_signals, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')`)
        .run(
          speakerName,
          normalized,
          context || speakerTitle,
          matched.person_id,
          matched.canonical_name,
          llmResult.confidence,
          JSON.stringify({ llmConfidence: llmResult.confidence, reasoning: llmResult.reasoning })
        );

      logger.debug('disambiguator', 'added_to_review', {
        name: speakerName,
        candidateId: matched.person_id,
        confidence: llmResult.confidence,
      });

      return newPersonId;
    }
  }

  // Step 5: Create new person
  return createNewPerson(speakerName, speakerTitle, nameParts, db);
}

/**
 * Create a new person record
 */
function createNewPerson(speakerName, speakerTitle, nameParts, db) {
  const normalized = normalizeName(speakerName);

  // Create person
  const result = db.prepare(`INSERT INTO persons (canonical_name, disambiguation, metadata)
    VALUES (?, ?, '{}')`)
    .run(speakerName, speakerTitle || null);

  const personId = result.lastInsertRowid;

  // Add primary alias
  db.prepare(`INSERT INTO person_aliases (person_id, alias, alias_normalized, alias_type, confidence, source)
    VALUES (?, ?, ?, 'full_name', 1.0, 'extraction')`)
    .run(personId, speakerName, normalized);

  // Add phonetic codes
  const metaphoneCodes = getMetaphoneCodes(nameParts.last);
  for (const code of metaphoneCodes) {
    db.prepare(`INSERT INTO person_phonetics (person_id, name_part, metaphone_code, part_type)
      VALUES (?, ?, ?, 'last')`)
      .run(personId, nameParts.last, code);
  }

  if (nameParts.first) {
    const firstCodes = getMetaphoneCodes(nameParts.first);
    for (const code of firstCodes) {
      db.prepare(`INSERT INTO person_phonetics (person_id, name_part, metaphone_code, part_type)
        VALUES (?, ?, ?, 'first')`)
        .run(personId, nameParts.first, code);
    }
  }

  logger.debug('disambiguator', 'new_person_created', { name: speakerName, personId });

  return personId;
}

export default { resolvePersonId, normalizeName };
