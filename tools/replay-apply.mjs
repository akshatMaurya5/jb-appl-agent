#!/usr/bin/env node
// replay-apply.mjs — re-run the classification/FAQ tiers against a captured
// failed application, with no browser and no network.
//
//   node tools/replay-apply.mjs                 # list captured runs
//   node tools/replay-apply.mjs --latest        # most recent run
//   node tools/replay-apply.mjs --run 2026-10-26-acme-a1b2c3
//   node tools/replay-apply.mjs --latest --unresolved   # only fields still unresolved
//
// WHY THIS EXISTS
// ---------------
// `autofill.mjs` writes `data/apply-runs/{date}-{company}-{hash}/` on every
// failed job (lib/failure-artifacts.mjs): meta.json, page.html, screenshot.png,
// inventory.json, transcript.txt. Without a replayer, "did the fix work?" can
// only be answered by finding the same live posting and applying again — which,
// for an expired posting, is impossible.
//
// WHAT IT REPLAYS, AND WHAT IT DELIBERATELY DOES NOT
// --------------------------------------------------
// It replays the two tiers that are pure functions of the question text:
//
//   tier 2 — taxonomy classification (lib/form-answer-engine.mjs → classify)
//   tier 3 — FAQ store reuse        (lib/application-faq.mjs → findFaqMatch)
//
// It does NOT replay tier 1 (profile-backed answers), because the profile
// loader lives inside autofill.mjs and needs the full mapped profile object;
// reproducing it here would be a second implementation that drifts. A field this
// tool reports as `no-category`/`no-faq` may still have been answerable from the
// profile on the live run — read it together with the captured inventory's own
// `current_value` and the transcript.
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { load as loadYaml } from 'js-yaml';
import { readFileSync } from 'node:fs';
import { getCareerOpsRoot } from '../path-resolver.mjs';
import { listApplyRuns, readApplyRun } from '../lib/failure-artifacts.mjs';
import { classify } from '../lib/form-answer-engine.mjs';
import { findFaqMatch } from '../lib/application-faq.mjs';
import { isUnreadableQuestion } from '../lib/question-context.mjs';
import { isMainModule } from '../lib/is-main-module.mjs';

function loadProfile() {
  const root = getCareerOpsRoot();
  const path = resolve(root, 'config/profile.yml');
  if (!existsSync(path)) return { raw: {}, root };
  try {
    return { raw: loadYaml(readFileSync(path, 'utf8')) || {}, root };
  } catch {
    return { raw: {}, root };
  }
}

/**
 * Classify and match one captured field.
 *
 * `answerFor` is `null` because the profile tier is not replayed (see header);
 * `faq` still shows whether an answer exists to reuse, which is exactly the
 * signal needed when a field stayed empty for lack of a precedent.
 */
function inspectField(field, { root, profile, company }) {
  // The live inventory names the field `context`; captured FAQs name it
  // `question`. Accept either so a replay works on both shapes.
  const question = String(field.context || field.question || '');
  if (!question) return { question, verdict: 'no-question' };
  if (isUnreadableQuestion(question)) return { question, verdict: 'unreadable', category: '', faq: null };
  let category = '';
  try { category = classify(question, profile) || ''; } catch { category = ''; }
  let faq = null;
  try {
    faq = findFaqMatch(root, question, { category, company });
  } catch { faq = null; }
  const verdict = category && faq ? 'both' : category ? 'category-only' : faq ? 'faq-only' : 'nothing';
  return { question, verdict, category, faq };
}

function printRun(name) {
  const root = getCareerOpsRoot();
  const { raw: profile } = loadProfile();
  const run = readApplyRun(root, name);
  const meta = run.meta || {};
  console.log(`\n== ${name} ==`);
  console.log(`   company: ${meta.company || '?'} | role: ${meta.role || '?'}`);
  console.log(`   reason:  ${meta.reason || '?'} (phase ${meta.phase || '?'})`);
  console.log(`   url:     ${meta.url || '?'}`);
  if (meta.final_url && meta.final_url !== meta.url) console.log(`   landed:  ${meta.final_url}`);
  console.log(`   planner: ${meta.planner_available ? 'available' : 'unavailable'} ${meta.planner_detail ? `(${meta.planner_detail})` : ''}`);
  const inventory = Array.isArray(run.inventory) ? run.inventory : [];
  const unreadable = (meta.unreadable_fields || []).length;
  const refusals = (meta.choice_refusals || []).length;
  console.log(`   captured: ${inventory.length} control(s); ${unreadable} unreadable; ${refusals} typed choice refusal(s)`);
  if (refusals) {
    for (const refusal of meta.choice_refusals || []) {
      console.log(`     ⛔ ${refusal.control || 'choice'}: ${refusal.reason} — "${String(refusal.value || '').slice(0, 40)}" vs ${(refusal.candidates || []).length} candidate(s)`);
    }
  }
  const rows = inventory
    .filter(item => item && item.context)
    .map(item => ({ item, result: inspectField(item, { root, profile, company: meta.company || '' }) }));
  const counts = rows.reduce((acc, row) => ({ ...acc, [row.result.verdict]: (acc[row.result.verdict] || 0) + 1 }), {});
  console.log(`   today's tiers: ${Object.entries(counts).map(([key, value]) => `${key}=${value}`).join(' ') || 'no readable fields'}`);
  return rows;
}

if (isMainModule(import.meta.url)) {
  const args = process.argv.slice(2);
  const valueAfter = name => {
    const index = args.indexOf(`--${name}`);
    return index >= 0 ? args[index + 1] : undefined;
  };
  const onlyUnresolved = args.includes('--unresolved');
  const requested = valueAfter('run');
  const root = getCareerOpsRoot();
  const names = requested ? [requested] : listApplyRuns(root, { filter: '' });
  if (!names.length) {
    console.log('No captured apply runs in data/apply-runs/. Failures capture themselves automatically (lib/failure-artifacts.mjs).');
    process.exitCode = 0;
  } else {
    const selected = args.includes('--latest') ? names.slice(0, 1) : requested ? names : names.slice(0, 5);
    for (const name of selected) {
      const rows = printRun(name);
      const shown = onlyUnresolved ? rows.filter(row => row.result.verdict === 'nothing' || row.result.verdict === 'unreadable') : rows;
      for (const { item, result } of shown) {
        const label = String(item.context || '').replace(/\s+/g, ' ').slice(0, 90);
        const answer = String(item.current_value || '').slice(0, 30);
        console.log(`     [${result.verdict}] ${label}${answer ? `  (value: ${answer})` : ''}`);
      }
    }
  }
}
