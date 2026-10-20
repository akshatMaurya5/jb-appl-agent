// application-faq.mjs — the FAQS.md question bank: append-only record of
// application form questions, choices, and answers with provenance.
//
// Reuse ladder (upgraded from exact-only):
//   Tier 0 — normalized-exact question match (existing behavior, unchanged).
//   Tier 1 — token-set similarity (Dice-style via similarityScore from
//            lib/option-matching.mjs: stopwords, synonym folding, and yes/no
//            polarity folding so opposite answers never share tokens).
//            Accepted at score >= 0.75 with a >= 0.15 lead over the runner-up.
//   Tier 2 — the same similarity scoped to FAQ entries whose stored
//            `category` (written at record time by recordApplicationFaq)
//            matches the current question's classified category.
// Sensitive/legal questions stay gated by FAQ_SENSITIVE in every tier.
//
// Option precedents: findFaqPrecedent() returns a past chosen option when it
// still appears among the current form's options.
import { existsSync, readFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { similarityScore } from './option-matching.mjs';

const FILE_NAME = 'FAQS.md';
const RECORD_START = '<!-- career-ops-application-faq-json -->';
const RECORD_END = '<!-- /career-ops-application-faq-json -->';
const SIMILARITY_MIN = 0.75;
const SIMILARITY_LEAD = 0.15;

export function faqFile(root) { return join(root, FILE_NAME); }

export function normalizeFaqQuestion(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function readRecords(root) {
  const path = faqFile(root);
  if (!existsSync(path)) return [];
  const source = readFileSync(path, 'utf8');
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

const FAQ_SENSITIVE = /salary|compensation|pay|sponsorship|visa|authorized|authorization|right to work|citizenship|nationality|gender|race|ethnicity|hispanic|latino|disability|veteran|orientation|pronoun|address|phone|email|name|date of birth|notice period|start date|consent|agree|data transfer|data protection|personal data|gdpr|arbitration|background check|criminal|work pass|work permit|employment pass|relocation|years of experience|terms and conditions/i;

/** Safe prior ordinary answers for semantic matching by the active host agent. */
export function readReusableFaq(root) {
  return readRecords(root).flatMap(record => (record.questions || [])
    .filter(item => !FAQ_SENSITIVE.test(item.question || '') && item.answer_source &&
      typeof item.answer === 'string' && item.answer.trim())
    .map(item => ({
      company: record.company || '', role: record.role || '',
      question: item.question, input_type: item.input_type,
      options: item.options || [], answer: item.answer,
      category: item.category || '',
      provenance: item.answer_source,
    })));
}

function answerableItems(root) {
  return readRecords(root).flatMap(record => (record.questions || [])
    .filter(item => !FAQ_SENSITIVE.test(item.question || '') && item.answer_source &&
      typeof item.answer === 'string' && item.answer.trim())
    .map(item => ({ question: item.question || '', answer: item.answer.trim(), category: item.category || '' })));
}

function singleDistinctAnswer(items) {
  const distinct = [...new Set(items.map(item => item.answer))];
  return distinct.length === 1 ? distinct[0] : '';
}

/**
 * Reuse ladder: exact → whole-store similarity → category-scoped similarity.
 * Returns a single consistent answer string, or '' when the store disagrees
 * or nothing clears the gates. Sensitive questions never reuse.
 */
export function findFaqAnswer(root, question, { category } = {}) {
  const key = normalizeFaqQuestion(question);
  if (!key || FAQ_SENSITIVE.test(question)) return '';

  // Tier 0: exact.
  const exact = answerableItems(root).filter(item => normalizeFaqQuestion(item.question) === key);
  if (exact.length) return singleDistinctAnswer(exact);

  // Tier 1: whole-store similarity.
  const scored = answerableItems(root)
    .map(item => ({ ...item, score: similarityScore(question, item.question) }))
    .filter(item => item.score >= SIMILARITY_MIN)
    .sort((a, b) => b.score - a.score);
  if (scored.length) {
    const lead = scored.length > 1 ? scored[0].score - scored[1].score : 1;
    if (lead >= SIMILARITY_LEAD) return scored[0].answer;
  }

  // Tier 2: same category, same similarity gates.
  if (category) {
    const scoped = answerableItems(root)
      .filter(item => item.category === category)
      .map(item => ({ ...item, score: similarityScore(question, item.question) }))
      .filter(item => item.score >= SIMILARITY_MIN)
      .sort((a, b) => b.score - a.score);
    if (scoped.length) {
      const lead = scoped.length > 1 ? scoped[0].score - scoped[1].score : 1;
      if (lead >= SIMILARITY_LEAD) return scoped[0].answer;
    }
  }
  return '';
}

/**
 * Option precedent: a past chosen answer that still appears among the current
 * form's options. Returns the matching option text, or '' when the precedent
 * is not among the options (the store's answer text may have been free-form).
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
 * snapshot. Each question gains `category` (classified from the taxonomy) and
 * `category_source`, so future similarity lookups can scope by category and
 * the store grows pre-categorized.
 */
export async function recordApplicationFaq(root, record, { taxonomy: providedTaxonomy } = {}) {
  if (!Array.isArray(record?.questions) || !record.questions.length) return;
  const taxonomyData = providedTaxonomy ?? await taxonomy();
  const { classifyQuestion } = await import('./form-categories.mjs');
  for (const item of record.questions) {
    if (!item?.question || item.category) continue;
    item.category = classifyQuestion(item.question, taxonomyData).id;
    item.category_source = 'form-categories-v1';
  }
  const path = faqFile(root);
  mkdirSync(dirname(path), { recursive: true });
  const header = existsSync(path) ? '' : [
    '# Application FAQs',
    '',
    'Accumulated application form questions, choices, and answers. Answers retain provenance; reuse is exact- or similarity-matched and excludes sensitive/legal fields. Each question carries a form-category tag.',
    '',
  ].join('\n');
  const block = `${header}${header ? '' : '\n'}## ${record.company || 'Unknown company'} — ${record.role || 'Unknown role'} (${record.date})\n\n${RECORD_START}\n${JSON.stringify(record, null, 2)}\n${RECORD_END}\n`;
  appendFileSync(path, block, 'utf8');
}
