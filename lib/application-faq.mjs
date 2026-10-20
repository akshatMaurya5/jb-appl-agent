import { existsSync, readFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

const FILE_NAME = 'FAQS.md';
const RECORD_START = '<!-- career-ops-application-faq-json -->';
const RECORD_END = '<!-- /career-ops-application-faq-json -->';

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
      provenance: item.answer_source,
    })));
}

/** Exact-question reuse only; sensitive and legal responses stay profile/action-time gated. */
export function findFaqAnswer(root, question) {
  const key = normalizeFaqQuestion(question);
  if (!key || FAQ_SENSITIVE.test(question)) return '';
  const matches = readRecords(root).flatMap(record => record.questions || [])
    .filter(item => normalizeFaqQuestion(item.question) === key &&
      item.answer_source && typeof item.answer === 'string' && item.answer.trim());
  if (!matches.length) return '';
  const distinct = [...new Set(matches.map(item => item.answer.trim()))];
  return distinct.length === 1 ? distinct[0] : '';
}

/** Append a complete, machine-readable application inventory and response snapshot. */
export function recordApplicationFaq(root, record) {
  if (!Array.isArray(record?.questions) || !record.questions.length) return;
  const path = faqFile(root);
  mkdirSync(dirname(path), { recursive: true });
  const header = existsSync(path) ? '' : [
    '# Application FAQs',
    '',
    'Accumulated application form questions, choices, and answers. Answers retain provenance; reuse is exact-question only and excludes sensitive/legal fields.',
    '',
  ].join('\n');
  const block = `${header}${header ? '' : '\n'}## ${record.company || 'Unknown company'} — ${record.role || 'Unknown role'} (${record.date})\n\n${RECORD_START}\n${JSON.stringify(record, null, 2)}\n${RECORD_END}\n`;
  appendFileSync(path, block, 'utf8');
}
