#!/usr/bin/env node
// One-time category backfill for FAQS.md: every question written before the
// category engine shipped carries no `category` tag. This classifies each one
// with the current taxonomy (lib/form-categories.mjs) and rewrites ONLY the
// fenced JSON blocks — all surrounding prose is preserved byte-for-byte.
//
//   node tools/backfill-faq-categories.mjs            # report (default)
//   node tools/backfill-faq-categories.mjs --dry-run  # same as default
//   node tools/backfill-faq-categories.mjs --apply    # rewrite with .bak
//   node tools/backfill-faq-categories.mjs --root /path/to/data-root
import { readFileSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadCategoryTaxonomy, classifyQuestion } from '../lib/form-categories.mjs';
import { getCareerOpsRoot } from '../path-resolver.mjs';

const RECORD_START = '<!-- career-ops-application-faq-json -->';
const RECORD_END = '<!-- /career-ops-application-faq-json -->';
const BACKFILL_SOURCE = 'form-categories-v1-backfill';

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const rootFlag = args.indexOf('--root');
const root = rootFlag >= 0 ? resolve(args[rootFlag + 1]) : getCareerOpsRoot();
const faqPath = resolve(root, 'FAQS.md');

if (!existsSync(faqPath)) {
  console.error(`No FAQS.md at ${faqPath}.`);
  process.exit(1);
}

const taxonomy = loadCategoryTaxonomy({ profile: null });
const source = readFileSync(faqPath, 'utf8');
const pattern = new RegExp(`${RECORD_START}\\s*([\\s\\S]*?)\\s*${RECORD_END}`, 'g');
const blocks = [...source.matchAll(pattern)];

const counts = new Map();
let tagged = 0;
let alreadyTagged = 0;
let totalQuestions = 0;
const rewrites = new Map(); // match index -> new JSON string

for (const [index, match] of blocks.entries()) {
  let record;
  try {
    record = JSON.parse(match[1]);
  } catch {
    console.warn(`⚠ Block ${index + 1} is malformed JSON; leaving it untouched.`);
    continue;
  }
  let changed = false;
  for (const item of record.questions || []) {
    if (!item?.question) continue;
    totalQuestions++;
    const category = classifyQuestion(item.question, taxonomy).id;
    counts.set(category, (counts.get(category) || 0) + 1);
    if (!item.category) {
      item.category = category;
      item.category_source = BACKFILL_SOURCE;
      tagged++;
      changed = true;
    } else {
      alreadyTagged++;
    }
  }
  if (changed) rewrites.set(match, JSON.stringify(record, null, 2));
}

console.log(`FAQS.md: ${blocks.length} record block(s), ${totalQuestions} question(s).`);
console.log(`  Tagged now: ${tagged} · already tagged: ${alreadyTagged}`);
console.log('\nPer-category counts:');
for (const [category, count] of [...counts.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(count).padStart(4)}  ${category}`);
}

if (!apply) {
  console.log(`\nDry run — no changes written. Re-run with --apply to tag ${tagged} question(s).`);
  process.exit(0);
}

if (!tagged) {
  console.log('\nNothing to write: every question already carries a category.');
  process.exit(0);
}

const backup = `${faqPath}.bak-${new Date().toISOString().replace(/[:.]/g, '-')}`;
copyFileSync(faqPath, backup);
let cursor = 0;
const parts = [];
for (const match of blocks) {
  parts.push(source.slice(cursor, match.index));
  parts.push(`${RECORD_START}\n${rewrites.get(match) ?? match[1].trim()}\n${RECORD_END}`);
  cursor = match.index + match[0].length;
}
parts.push(source.slice(cursor));
writeFileSync(faqPath, parts.join(''), 'utf8');
console.log(`\n✔ Rewrote ${rewrites.size} block(s); prose preserved. Backup: ${backup}`);
