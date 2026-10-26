#!/usr/bin/env node
// Offline end-to-end dry run of the apply engine against a local fixture
// (templates/ats/test-form.html): inventory → category fill → combobox
// location (city→state→country fallback) → verify loop → submit → mock OTP
// → confirmation. Zero PII, zero network, headless.
//
//   node tools/dry-run-apply.mjs
//
// Exercises the real lib stack: form-categories (classify), form-answer-
// engine (answerQuestion ladder), option-matching (matchOptions), autofill-
// form-utils (location fallback), form-verify (mandatoryCoverageLoop),
// otp-entry (enterVerificationCode), otp-flow (runOtpFlow).
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { answerQuestion, classify } from '../lib/form-answer-engine.mjs';
import { matchOptions } from '../lib/option-matching.mjs';
import { locationSuggestionWithFallback } from '../lib/autofill-form-utils.mjs';
import { mandatoryCoverageLoop } from '../lib/form-verify.mjs';
import { enterVerificationCode } from '../lib/otp-entry.mjs';
import { runOtpFlow } from '../lib/otp-flow.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const fixtureUrl = pathToFileURL(resolve(ROOT, '../templates/ats/test-form.html')).href;

// Synthetic candidate — deliberately not the user's profile; no PII.
const profile = {
  fullName: 'Jane Doe', email: 'jane@example.com', phone: '+91-10000-00000',
  linkedin: 'linkedin.com/in/jane', city: 'Jaipur', state: 'Karnataka', country: 'India',
  currentCompany: 'Acme Corp', noticePeriod: '30 days', referralSource: 'Company Career Page',
  yoe: '2.5', languages: ['English'], salaryDefault: '50000',
  authorizedIn: ['India'], sponsorshipRequired: true,
  raw: { candidate: { education: { university: 'Example University' } } },
};
const cv = '## Education\n### Example University -- Jalandhar, India\n**B.Tech, ECE**\n2020 – 2024\n';
const target = { company: 'Acme Offline Fixture', location: 'India' };
const rows = [];
const reportedGroups = new Set();
const report = (field, answer, source, ok = true) => rows.push({ field, answer: String(answer).slice(0, 60), source, ok });

// CSS.escape is browser-only; Node needs an equivalent for the attribute
// selector built outside page.evaluate.
const escapeAttr = value => String(value ?? '').replace(/["\\]/g, match => `\\${match}`);

function contextForElement(node) {
  const label = node.labels?.[0]?.innerText || node.getAttribute('aria-label') || node.placeholder || node.name || node.id || '';
  return label.replace(/\s+/g, ' ').trim();
}

const { chromium } = await import('playwright');
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.goto(fixtureUrl);

// ---- fill pass -----------------------------------------------------------
async function fillPass() {
  const controls = page.locator('input:not([type="hidden"]):not([type="submit"]):not([type="button"]), textarea, select');
  for (let i = 0, n = await controls.count(); i < n; i++) {
    const el = controls.nth(i);
    if (!(await el.isVisible().catch(() => false))) continue;
    const type = (await el.getAttribute('type') || '').toLowerCase();
    const context = await el.evaluate(contextForElement);
    const category = classify(context, profile);
    const answer = answerQuestion(context, profile, cv, target);

    if (type === 'checkbox') {
      // Grouped checkboxes (languages, etc.) are answered by their fieldset
      // legend; lone policy checkboxes by their own label.
      const groupContext = await el.evaluate(node => node.closest('fieldset, [role="group"]')?.querySelector('legend')?.innerText?.trim() || '');
      const effectiveContext = groupContext || context;
      const category = classify(effectiveContext, profile);
      const answer = answerQuestion(effectiveContext, profile, cv, target);
      if (category === 'terms-consent') {
        await el.check();
        report(context, 'accepted (authorized terms policy)', 'category:terms-consent');
        continue;
      }
      const options = await el.evaluate(node => [...document.querySelectorAll(`input[type="checkbox"][name="${CSS.escape(node.name)}"]`)]
        .map(box => box.labels?.[0]?.innerText?.trim() || box.value).filter(Boolean));
      if (answer && options.length > 1) {
        let checkedAny = false;
        for (const option of options) {
          if (!matchOptions([{ text: option }], answer, effectiveContext).length) continue;
          const index = options.indexOf(option);
          if (index >= 0) {
            await page.locator(`input[type="checkbox"][name="${escapeAttr(await el.getAttribute('name'))}"]`).nth(index).check();
            checkedAny = true;
          }
        }
        if (checkedAny && !reportedGroups.has(effectiveContext)) {
          reportedGroups.add(effectiveContext);
          report(effectiveContext, answer, `category:${category}`);
        }
        continue;
      }
      if (answer && matchOptions([{ text: context }], answer, context).length) {
        await el.check();
        report(context, answer, `category:${category}`);
      }
      continue;
    }

    if (type === 'radio') continue; // handled in the group pass below
    if (el.evaluate !== undefined && await el.evaluate(node => node.tagName) === 'SELECT') {
      if (await el.inputValue().catch(() => '')) continue;
      const options = await el.locator('option').evaluateAll(nodes => nodes.filter(o => !o.disabled && (o.value || o.textContent.trim()) && !/select one|please select/i.test(o.textContent.trim())).map(o => ({ text: o.textContent.trim() })));
      const matches = answer ? matchOptions(options, answer, context) : [];
      if (matches.length === 1) { await el.selectOption({ label: matches[0].text }); report(context, matches[0].text, `category:${category}`); }
      continue;
    }

    const curVal = (await el.inputValue().catch(() => '')).trim();
    if (curVal) continue;
    if (answer) { await el.fill(answer); report(context, answer, `category:${category}`); }
  }

  // Radio groups.
  const groups = await page.evaluate(() => {
    const map = new Map();
    document.querySelectorAll('input[type="radio"]').forEach(node => {
      if (!(node.offsetWidth || node.offsetHeight || node.getClientRects().length)) return;
      const key = node.name;
      if (!map.has(key)) map.set(key, { key, options: [], context: '' });
      const group = map.get(key);
      group.options.push(node.labels?.[0]?.innerText?.trim() || node.value);
      group.context ||= node.closest('fieldset, [role="group"]')?.querySelector('legend')?.innerText?.trim() || '';
    });
    return [...map.values()];
  });
  for (const group of groups) {
    const checked = await page.locator(`input[type="radio"][name="${escapeAttr(group.key)}"]:checked`).count();
    if (checked) continue;
    const answer = answerQuestion(group.context, profile, cv, target);
    const matches = answer ? matchOptions(group.options.map(text => ({ text })), answer, group.context) : [];
    if (matches.length === 1) {
      const index = group.options.indexOf(matches[0].text);
      await page.locator(`input[type="radio"][name="${escapeAttr(group.key)}"]`).nth(index).check();
      report(group.context, matches[0].text, `category:${classify(group.context, profile)}`);
    }
  }
}

// ---- combobox (location) with city→state→country fallback -----------------
async function fillLocation() {
  const el = page.locator('#location-input');
  await el.fill(profile.city);
  const suggestionInfo = await page.locator('.suggestion').evaluateAll(nodes => nodes.map((node, index) => ({
    index,
    text: (node.innerText || node.textContent || '').replace(/\s+/g, ' ').trim(),
  })).filter(option => option.text));
  const fallback = locationSuggestionWithFallback(suggestionInfo, profile);
  if (!fallback) { report('location combobox', 'unmatched', 'location-fallback', false); return false; }
  await page.locator('.suggestion').nth(fallback.match.index).click();
  report('location combobox', fallback.match.text, `location-fallback:${fallback.level}`);
  return true;
}

// ---- mandatory coverage check --------------------------------------------
async function unresolved() {
  return page.evaluate(() => [...document.querySelectorAll('#form [required]')]
    .filter(el => el.type === 'checkbox' ? !el.checked : !String(el.value || '').trim())
    .map(el => el.labels?.[0]?.innerText || el.name || el.id || 'field').slice(0, 6));
}

console.log('Dry-run: filling the fixture with the category engine.\n');
await fillPass();
await fillLocation();
const coverage = await mandatoryCoverageLoop({
  fill: async round => { console.log(`  ↻ Verify round ${round}: re-fill pass.`); await fillPass(); },
  unresolved,
  rounds: 3,
});
if (!coverage.ok) {
  console.error(`\n✖ Mandatory coverage incomplete: ${coverage.unresolved.join('; ')}`);
  process.exit(1);
}

// ---- submit → mock OTP → confirmation ------------------------------------
await page.click('#submit');
await page.locator('#otp').waitFor({ state: 'visible', timeout: 3000 });
const otpResult = await runOtpFlow({
  detectInputs: async () => {
    const inputs = await page.locator('#code-boxes input').all();
    return inputs.length ? inputs : [];
  },
  fetchCode: async () => ({ code: await page.evaluate(() => window.__dryRunOtpCode), source: 'fixture-mock' }),
  enterCode: (inputs, code) => enterVerificationCode(inputs, code),
  clickVerify: async () => { await page.click('#verify'); return true; },
  followUpSubmit: async () => false,
  isConfirmed: async () => page.locator('#confirmation').isVisible().catch(() => false),
  company: target.company, submittedAt: Math.floor(Date.now() / 1000),
  confirmDeadlineMs: Date.now() + 60000, sleepMs: 200,
});
await page.locator('#confirmation').waitFor({ state: 'visible', timeout: 3000 });

// ---- report ---------------------------------------------------------------
console.log('\nField-by-field fill report:');
for (const row of rows) {
  console.log(`  ${row.ok ? '✔' : '⚠'} ${row.field.slice(0, 55).padEnd(55)} → ${row.answer || '(blank)'}  [${row.source}]`);
}
const passed = rows.every(row => row.ok);
console.log(`\n${passed ? '✅' : '⚠'} Dry run finished: ${rows.length} field(s) reported, OTP '${otpResult.status}' (${otpResult.source || ''}), confirmation visible.`);
await browser.close();
process.exit(passed ? 0 : 1);
