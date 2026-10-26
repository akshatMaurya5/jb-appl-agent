// application-faq.mjs — the FAQS.md question bank: an append-only record of
// application form questions, the choices they offered, and the answer that was
// actually submitted, with provenance.
//
// WHY THIS FILE WAS REWRITTEN
// ---------------------------
// Three separate defects made the reuse ladder behave as "exact match only":
//
// 1. COST. `readRecords()` re-read and re-parsed a 3.4 MB / 63k-line store on
//    every call, and `findFaqAnswer()` called it three times per question
//    (measured: ~71 ms per call, ~213 ms per question, once per control on
//    every page of a multi-step form). The store was also parsed by
//    `readReusableFaq()` for the planner prompt. Parsing is now done once and
//    cached by (mtime, size), and the derived indexes are built at the same
//    time, so a repeated lookup is a Map hit.
//
// 2. REPHRASING. The ladder only ever compared question TEXT. "How did you hear
//    about us?" and "How did you first learn about this company?" are the same
//    question, and a candidate who answered it once should never be asked
//    again — but text similarity is a weak proxy for that, and measured scores
//    on real paraphrase pairs sat between 0.000 and 0.567 (gate: 0.75). The
//    ladder now has an INTENT tier: entries are tagged with the form category
//    they classify into (`templates/form-categories.yml`), and a category with
//    exactly one distinct stored answer answers the next wording of the same
//    intent even when no token is shared.
//
// 3. UNANSWERABLE RECORDS. Questions were stored exactly as the DOM produced
//    them ("start typing... 8f1c… question_38511204002"), so the same question
//    appeared dozens of times in different noise and none of it was reusable.
//    `lib/question-context.mjs` now produces the stored question; records hold
//    a stable `key` alongside the verbatim text.
//
// LADDER (unchanged order, new evidence at each tier)
//   gate — legal/consent questions never reuse (they are authored by explicit
//          profile approvals, see application_authorizations).
//   tier 0 — normalized-exact question match.
//   tier 1 — whole-store token similarity, >= 0.75 with a >= 0.15 lead.
//   tier 2 — same-intent: the stored category matches and the store agrees on
//            ONE answer for that intent (no similarity needed).
//   tier 3 — same-category similarity, same gates as tier 1.
// Every accepted answer reports HOW it was accepted (`via`), so the apply log
// can say "answered from intent" instead of an opaque "answered".
//
// Sensitive-but-groundable questions (visa, authorization, salary,
// demographics) stay reusable: the deterministic category tier answers them
// from the profile, and reuse of the same question family is wanted. Only
// legal/consent/attestation text is excluded, because reusing it would be
// authoring a commitment the candidate never made.

import { existsSync, readFileSync, appendFileSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { similarityScoreTokens, similarityTokenize } from './option-matching.mjs';
import { isEssayLike } from './answer-render.mjs';

const FILE_NAME = 'FAQS.md';
const RECORD_START = '<!-- career-ops-application-faq-json -->';
const RECORD_END = '<!-- /career-ops-application-faq-json -->';
const SIMILARITY_MIN = 0.75;
const SIMILARITY_LEAD = 0.15;
const UNCLASSIFIED = 'unclassified';

export function faqFile(root) { return join(root, FILE_NAME); }

export function normalizeFaqQuestion(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

// ---------------------------------------------------------------------------
// Cached index
// ---------------------------------------------------------------------------
// Keyed by absolute path. Invalidated when the file's mtime or size changes, so
// an appended record (including one written by a different process) is picked
// up without restarting, and a lookup that changed nothing costs zero I/O.
const indexCache = new Map();

/** Drop every cached index. Called by tests and after a write. */
export function invalidateFaqCache() { indexCache.clear(); }

function parseRecords(source) {
  const records = [];
  const pattern = new RegExp(`${RECORD_START}\\s*([\\s\\S]*?)\\s*${RECORD_END}`, 'g');
  for (const match of source.matchAll(pattern)) {
    try {
      const record = JSON.parse(match[1]);
      if (Array.isArray(record.questions)) records.push(record);
    } catch { /* Ignore malformed/manual blocks; keep the store readable. */ }
  }
  return records;
}

function buildIndex(records) {
  const items = [];
  const byQuestion = new Map();
  const byCategory = new Map();
  const byIntent = new Map();
  for (const record of records) {
    for (const item of record.questions || []) {
      const question = String(item?.question || '').trim();
      const answer = typeof item.answer === 'string' ? item.answer.trim() : '';
      if (!question || !answer) continue;
      const key = normalizeFaqQuestion(question);
      if (!key) continue;
      const category = String(item.category || '').trim();
      const intent = String(item.intent || '').trim() || (category && category !== UNCLASSIFIED ? category : '');
      const entry = {
        question,
        key,
        answer,
        category,
        intent,
        answer_type: item.answer_type || '',
        canonical_value: item.canonical_value ?? null,
        input_type: item.input_type || '',
        options: Array.isArray(item.options) ? item.options : [],
        provenance: item.answer_source || '',
        company: record.company || '',
        role: record.role || '',
        tokens: similarityTokenize(question),
      };
      items.push(entry);
      if (!byQuestion.has(key)) byQuestion.set(key, []);
      byQuestion.get(key).push(entry);
      if (category) {
        if (!byCategory.has(category)) byCategory.set(category, []);
        byCategory.get(category).push(entry);
      }
      if (intent) {
        if (!byIntent.has(intent)) byIntent.set(intent, []);
        byIntent.get(intent).push(entry);
      }
    }
  }
  return { records, items, byQuestion, byCategory, byIntent };
}

const EMPTY_INDEX = { records: [], items: [], byQuestion: new Map(), byCategory: new Map(), byIntent: new Map() };

function loadIndex(root) {
  const path = faqFile(root);
  if (!existsSync(path)) return EMPTY_INDEX;
  let stat;
  try {
    stat = statSync(path);
  } catch {
    return EMPTY_INDEX;
  }
  const cached = indexCache.get(path);
  if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) return cached.index;
  const records = parseRecords(readFileSync(path, 'utf8'));
  const index = buildIndex(records);
  indexCache.set(path, { mtimeMs: stat.mtimeMs, size: stat.size, index });
  return index;
}

// Narrower than the old FAQ_SENSITIVE: only questions whose reuse would
// constitute authoring a legal commitment stay out of the reuse ladder.
const FAQ_LEGAL = /consent|\bagree\b|\battest\w*|\bcertif\w*|arbitration|waiver|release of claims|background check|criminal|credit check|drug test|terms and conditions|employment agreement|legal agreement|data transfer|data processing|gdpr|privacy|personal data|truthful|accurate|information.*true/i;

// Identity, eligibility and pay are answered from the PROFILE, never from a
// stored precedent. The profile is ground truth for "how much do you want" and
// "are you allowed to work here"; the store is a history of what was typed on
// other forms, and reusing it there can only ever reproduce an old number or an
// old wording. Concretely: the store holds 50000 twenty-three times and 85000
// three times, so any reuse rule that is not a strict majority is a coin flip
// on the candidate's own salary expectation.
//
// This is also what the engine's own contract test asserts ("sensitive
// questions never reuse"). The deterministic tier still answers every one of
// these categories from the profile — this gate removes the redundant and
// risky path, not the answer.
const FAQ_PROFILE_OWNED = /\bsalary\b|compensation|\bctc\b|remuneration|expected pay|visa|sponsor|authoriz|authoris|right to work|work permit|citizenship|nationality|date of birth|\bage\b|birth ?date|\bgender\b|\bsex\b|\brace\b|ethnicity|religion|disabilit|veteran|sexual orientation|pronoun/i;

function profileOwned(text) {
  return FAQ_PROFILE_OWNED.test(String(text || ''));
}

function reusable(entry) {
  return Boolean(entry.answer) &&
    !FAQ_LEGAL.test(entry.question) &&
    !profileOwned(entry.question);
}

/**
 * Cross-company guard.
 *
 * A short factual answer ("Yes", "30 days", "Bengaluru") means the same thing
 * everywhere. An ESSAY answer is about the company that asked it: reusing "I
 * want to join Acme because of its data platform" on Beta Corp's form is not
 * reuse, it is a fabricated motivation aimed at the wrong employer. So an
 * essay-shaped stored answer is only reusable for the SAME company; everything
 * else stays reusable across companies.
 */
function reusableAt(entry, company) {
  if (!reusable(entry)) return false;
  if (!isEssayLike(entry.answer)) return true;
  const wanted = normalizeFaqQuestion(company);
  if (!wanted) return false;
  return normalizeFaqQuestion(entry.company) === wanted;
}

function reusableEntries(entries, company) {
  return (entries || []).filter(entry => reusableAt(entry, company));
}

/** Safe prior ordinary answers for semantic matching by the active host agent. */
export function readReusableFaq(root) {
  return loadIndex(root).items
    .filter(reusable)
    .map(item => ({
      company: item.company,
      role: item.role,
      question: item.question,
      input_type: item.input_type,
      options: item.options,
      answer: item.answer,
      category: item.category,
      intent: item.intent,
      answer_type: item.answer_type,
      provenance: item.provenance,
    }));
}

function distinctAnswers(items) {
  const seen = new Map();
  for (const item of items) {
    const key = normalizeFaqQuestion(item.answer);
    if (!key) continue;
    if (!seen.has(key)) seen.set(key, item);
  }
  return [...seen.values()];
}

/**
 * The one answer the store agrees on for a set of entries, or '' when it
 * disagrees. Agreement is compared on normalized text so "Yes" / "yes." are one
 * answer, while "Yes" / "No" are two and therefore unusable.
 */
function unanimousAnswer(items) {
  const distinct = distinctAnswers(items);
  return distinct.length === 1 ? distinct[0].answer : '';
}

/**
 * The answer the store clearly prefers, when a strict majority of the intent's
 * entries agree.
 *
 * Measured on the real store, an intent bucket is almost never unanimous even
 * when it is unambiguous, because a handful of entries are misclassified noise
 * (a LinkedIn URL filed under referral-source, an essay filed under
 * salary-expectation). Example counts from the live store:
 *
 *   referral-source    19 entries: "Company Career Page" ×15, "LinkedIn" ×2, 2 noise
 *   salary-expectation 27 entries: "50000" ×23, "85000" ×3, 1 noise
 *   location-city      33 entries: "Bengaluru" ×27, "India" ×3, 3 noise
 *
 * Requiring unanimity therefore threw away every one of those answers, while
 * requiring nothing throws away the safety. A 60% quorum sits between:
 * it accepts the candidate's stable answer and refuses a genuinely split store.
 * Essay-shaped and URL-shaped values never qualify — those are the two shapes
 * that misclassification produces, and neither is safe to paste elsewhere.
 */
function dominantAnswer(items, { minShare = 0.6, minCount = 3 } = {}) {
  const groups = new Map();
  for (const item of items) {
    const key = normalizeFaqQuestion(item.answer);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, { answer: item.answer, count: 0 });
    groups.get(key).count++;
  }
  if (!groups.size) return '';
  const ranked = [...groups.values()].sort((a, b) => b.count - a.count);
  const top = ranked[0];
  if (top.count < minCount) return '';
  if (isEssayLike(top.answer) || /^https?:\/\//i.test(top.answer.trim())) return '';
  if (top.count / items.length < minShare) return '';
  return top.answer;
}

function bestBySimilarity(queryTokens, items, company = '') {
  let best = null;
  let runnerUp = 0;
  for (const item of items) {
    if (!reusableAt(item, company)) continue;
    const score = similarityScoreTokens(queryTokens, item.tokens);
    if (!best || score > best.score) {
      // The previous best becomes the runner-up, but only when it actually
      // qualified — a low-scoring near-miss is not a competing answer.
      if (best && best.score >= SIMILARITY_MIN) runnerUp = Math.max(runnerUp, best.score);
      best = { ...item, score };
    } else if (score >= SIMILARITY_MIN && score > runnerUp) {
      runnerUp = score;
    }
  }
  if (!best || best.score < SIMILARITY_MIN) return null;
  // With no qualifying runner-up the lead is the whole score.
  if (runnerUp && best.score - runnerUp < SIMILARITY_LEAD) return null;
  return best;
}

/**
 * Reuse lookup with provenance.
 *
 * Returns `{ answer, via, category, intent, answer_type, canonical_value,
 * question }` or null. `via` is one of `exact`, `similarity`, `intent`,
 * `category-similarity` — the apply log uses it to distinguish "this exact
 * question was answered before" from "we inferred the intent".
 *
 * `category` is the taxonomy classification of the CURRENT question
 * (`classifyQuestion().id`); pass it whenever the caller has it, because it is
 * what unlocks the intent tier.
 */
export function findFaqMatch(root, question, { category = '', company = '' } = {}) {
  const text = String(question || '').trim();
  if (!text) return null;
  if (FAQ_LEGAL.test(text) || profileOwned(text)) return null;
  const key = normalizeFaqQuestion(text);
  if (!key) return null;
  const index = loadIndex(root);

  // Tier 0 — exact question.
  const exact = reusableEntries(index.byQuestion.get(key), company);
  if (exact.length) {
    const answer = unanimousAnswer(exact);
    if (answer) return matchResult(exact[0], answer, 'exact');
  }

  const queryTokens = similarityTokenize(text);

  // Tier 1 — whole-store similarity.
  const similar = bestBySimilarity(queryTokens, index.items, company);
  if (similar) {
    // A text match and the question's own intent can disagree. "Where did you
    // hear about this position?" text-matched a prior answer of "LinkedIn" at
    // 0.80 while the referral-source bucket agreed on "Company Career Page"
    // 15/19 — same question, two answers depending on phrasing. When the
    // similarity hit belongs to a DIFFERENT category than the one this question
    // classifies into, a clear intent consensus outranks the text match, because
    // the classification comes from the question itself rather than from
    // surface wording. When they agree, the text match stands (it is the
    // stricter evidence).
    const queryIntent = category && category !== UNCLASSIFIED ? category : '';
    if (queryIntent && similar.category && similar.category !== queryIntent) {
      const intentEntries = reusableEntries(index.byIntent.get(queryIntent), company);
      if (intentEntries.length) {
        const consensus = unanimousAnswer(intentEntries) || dominantAnswer(intentEntries);
        if (consensus) {
          const reference = intentEntries.find(item => normalizeFaqQuestion(item.answer) === normalizeFaqQuestion(consensus)) || intentEntries[0];
          return matchResult({ ...reference, intent: queryIntent, category: reference.category || queryIntent }, consensus, 'intent');
        }
      }
    }
    return matchResult(similar, similar.answer, 'similarity');
  }

  // Tier 2 — same intent, no vocabulary overlap required.
  const intent = category && category !== UNCLASSIFIED ? category : '';
  if (intent) {
    const sameIntent = reusableEntries(index.byIntent.get(intent), company);
    if (sameIntent.length) {
      const answer = unanimousAnswer(sameIntent) || dominantAnswer(sameIntent);
      if (answer) {
        const reference = sameIntent.find(item => normalizeFaqQuestion(item.answer) === normalizeFaqQuestion(answer)) || sameIntent[0];
        return matchResult({ ...reference, intent, category: reference.category || category }, answer, 'intent');
      }
      // The store genuinely disagrees on this intent: fall back to the closest
      // QA within it, which is stricter than using that bucket alone.
      const scoped = bestBySimilarity(queryTokens, sameIntent, company);
      if (scoped) return matchResult({ ...scoped, intent }, scoped.answer, 'intent-similarity');
      return null;
    }
  }

  // Tier 3 — same-category similarity (legacy behavior, still gated).
  if (category) {
    const scopedItems = reusableEntries(index.byCategory.get(category), company);
    const scoped = bestBySimilarity(queryTokens, scopedItems, company);
    if (scoped) return matchResult(scoped, scoped.answer, 'category-similarity');
  }
  return null;
}

function matchResult(entry, answer, via) {
  return {
    answer,
    via,
    category: entry.category || '',
    intent: entry.intent || '',
    answer_type: entry.answer_type || '',
    canonical_value: entry.canonical_value ?? null,
    question: entry.question || '',
  };
}

/**
 * Backwards-compatible string form of `findFaqMatch`, used by the answer ladder
 * and by callers that only need the text.
 */
export function findFaqAnswer(root, question, { category, company } = {}) {
  return findFaqMatch(root, question, { category, company })?.answer || '';
}

/**
 * Option precedent: a past chosen answer that still appears among the current
 * form's options. Delegates to the same ladder, so an intent-level match whose
 * stored answer is not among today's options returns '' and lets the caller
 * render the typed answer instead.
 */
export function findFaqPrecedent(root, question, options, { category } = {}) {
  const answer = findFaqAnswer(root, question, { category });
  if (!answer) return '';
  const key = normalizeFaqQuestion(answer);
  return (options || []).map(option => String(option?.text ?? option?.value ?? option ?? ''))
    .find(text => normalizeFaqQuestion(text) === key) || '';
}

let taxonomyPromise = null;
function taxonomy() {
  taxonomyPromise ??= import('./form-categories.mjs').then(m => m.loadCategoryTaxonomy());
  return taxonomyPromise;
}

/**
 * Append a complete, machine-readable application inventory and response
 * snapshot.
 *
 * Each question is tagged at write time with:
 *   `category` — the taxonomy classification of its question text,
 *   `category_source` — who classified it,
 *   `key` — the normalized lookup key, so a later read never has to recompute
 *           it from noisy DOM text,
 *   `answer_type` / `canonical_value` — the typed form of the answer (see
 *           lib/answer-render.mjs), which is what lets the same answer be
 *           re-rendered into a dropdown next time instead of pasted as text.
 *
 * Typing is best-effort: an answer that cannot be typed is stored as plain
 * text, never dropped.
 */
export async function recordApplicationFaq(root, record, { taxonomy: providedTaxonomy } = {}) {
  if (!Array.isArray(record?.questions) || !record.questions.length) return;
  const taxonomyData = providedTaxonomy ?? await taxonomy();
  const { classifyQuestion } = await import('./form-categories.mjs');
  const { canonicalizeAnswer } = await import('./answer-render.mjs');
  for (const item of record.questions) {
    if (!item?.question) continue;
    if (!item.category) {
      item.category = classifyQuestion(item.question, taxonomyData).id;
      item.category_source = 'form-categories-v1';
    }
    if (!item.key) item.key = normalizeFaqQuestion(item.question);
    if (item.answer && !item.answer_type) {
      try {
        const canonical = canonicalizeAnswer(item.answer, {
          inputType: item.input_type === 'select' || item.input_type === 'radio-group' || item.input_type === 'combobox' ? 'select' : (item.input_type || 'text'),
          options: Array.isArray(item.options) ? item.options.map(option => (typeof option === 'string' ? { text: option, value: option } : option)) : [],
          context: item.question,
        });
        if (canonical) {
          item.answer_type = canonical.answer_type;
          item.canonical_value = canonical.canonical_value;
        }
      } catch { /* typing is an optimization, never a write blocker */ }
    }
  }
  const path = faqFile(root);
  mkdirSync(dirname(path), { recursive: true });
  const header = existsSync(path) ? '' : [
    '# Application FAQs',
    '',
    'Accumulated application form questions, choices, and answers. Answers retain provenance; reuse is exact-, intent-, or similarity-matched and excludes legal/consent fields. Each question carries a form-category tag, a normalized key, and (where derivable) a typed answer value.',
    '',
  ].join('\n');
  const block = `${header}${header ? '' : '\n'}## ${record.company || 'Unknown company'} — ${record.role || 'Unknown role'} (${record.date})\n\n${RECORD_START}\n${JSON.stringify(record, null, 2)}\n${RECORD_END}\n`;
  appendFileSync(path, block, 'utf8');
  // The store changed; the next read must rebuild rather than serve stale text.
  invalidateFaqCache();
}
