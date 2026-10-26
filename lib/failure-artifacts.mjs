// failure-artifacts.mjs — capture what the form looked like when an application
// failed, so the failure can be diagnosed offline instead of guessed at.
//
// WHY THIS EXISTS
// ---------------
// `data/apply-failures.tsv` records that a job failed and in which phase, but
// nothing about the page. The ledger's dominant reason is
// `unconfirmed-submission` (46 of 62 rows), and that reason is compatible with
// at least four completely different failures: the submit button was never
// found, the form required a field nobody could answer, the click landed but the
// board rejected validation, or the confirmation text simply is not one of the
// phrases the detector knows. Without the page, all four look identical, which
// is why the same boards kept failing run after run with no way to tell whether
// a fix worked.
//
// So every failed job now leaves a directory:
//
//   data/apply-runs/{YYYY-MM-DD}-{company-slug}-{hash}/
//     meta.json        reason, phase, url, timings, planner availability, counts
//     page.html        the live DOM at failure time
//     screenshot.png   what the candidate would have seen
//     inventory.json   the controls found, their labels, options, unresolved state
//     transcript.txt   the process's own log lines for this job
//
// `tools/replay-apply.mjs` reads that directory and re-runs the DETERMINISTIC
// answer ladder against the captured inventory, so "would today's rules have
// filled this?" is answerable without a browser and without the live posting.
//
// Everything here is best-effort: an artifact that cannot be written must never
// turn a failed application into a crashed runner.

import { mkdirSync, writeFileSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { localToday } from './local-today.mjs';

/** Directory name for one failed run. Stable enough to find by company + date. */
export function artifactSlug({ company = '', url = '', reason = '' } = {}) {
  const base = String(company || url || 'unknown')
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'unknown';
  const suffix = String(url || reason || '')
    .split('')
    .reduce((hash, char) => ((hash * 31 + char.charCodeAt(0)) >>> 0), 7)
    .toString(36)
    .slice(0, 6);
  return `${localToday()}-${base}-${suffix}`;
}

export function applyRunsRoot(root) {
  return resolve(root, 'data/apply-runs');
}

function writeText(path, text) {
  try {
    writeFileSync(path, text, 'utf8');
    return true;
  } catch {
    return false;
  }
}

/**
 * Capture a failed apply run.
 *
 * `page` is optional (a timeout may already have killed the tab), `inventory`
 * and `transcript` are passed by the caller because only it knows them.
 * Returns the directory path, or null when nothing could be written.
 */
export async function captureFailureArtifacts(root, {
  company = '', role = '', url = '', reason = '', phase = '',
  elapsedMs = 0, plannerAvailable = false, plannerDetail = '',
  page = null, inventory = [], transcript = [], extra = {},
} = {}) {
  const dir = resolve(applyRunsRoot(root), artifactSlug({ company, url, reason }));
  try {
    mkdirSync(dir, { recursive: true });
  } catch (error) {
    console.warn(`  ⚠ Could not create the failure-artifact directory: ${error.message}`);
    return null;
  }

  const meta = {
    captured_at: new Date().toISOString(),
    date: localToday(),
    company, role, url, reason, phase,
    elapsed_ms: elapsedMs,
    planner_available: Boolean(plannerAvailable),
    planner_detail: plannerDetail || '',
    inventory_size: Array.isArray(inventory) ? inventory.length : 0,
    ...extra,
  };
  writeText(resolve(dir, 'meta.json'), `${JSON.stringify(meta, null, 2)}\n`);
  if (Array.isArray(inventory)) writeText(resolve(dir, 'inventory.json'), `${JSON.stringify(inventory, null, 2)}\n`);
  if (Array.isArray(transcript) && transcript.length) writeText(resolve(dir, 'transcript.txt'), `${transcript.join('\n')}\n`);

  if (page) {
    try {
      const html = await page.content();
      writeText(resolve(dir, 'page.html'), html);
    } catch { /* a closed page has no content; meta.json still explains why */ }
    try {
      await page.screenshot({ path: resolve(dir, 'screenshot.png'), fullPage: true });
    } catch { /* headless or already-closed pages cannot be captured */ }
    try {
      meta.final_url = page.url();
      writeText(resolve(dir, 'meta.json'), `${JSON.stringify(meta, null, 2)}\n`);
    } catch { /* url() on a closed page throws; ignore */ }
  }

  console.warn(`  📸 Saved failure artifacts: ${dir}`);
  return dir;
}

/** Newest-first list of captured runs, optionally filtered by a substring. */
export function listApplyRuns(root, { filter = '' } = {}) {
  const base = applyRunsRoot(root);
  if (!existsSync(base)) return [];
  let entries = [];
  try {
    entries = readdirSync(base, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name);
  } catch {
    return [];
  }
  const wanted = String(filter || '').toLowerCase();
  return entries
    .filter(name => !wanted || name.toLowerCase().includes(wanted))
    .sort()
    .reverse();
}

/** Read one captured run. Throws only when the directory has no meta.json. */
export function readApplyRun(root, name) {
  const dir = resolve(applyRunsRoot(root), name);
  const metaPath = resolve(dir, 'meta.json');
  if (!existsSync(metaPath)) throw new Error(`No meta.json in ${dir}`);
  const inventoryPath = resolve(dir, 'inventory.json');
  return {
    dir,
    meta: JSON.parse(readFileSync(metaPath, 'utf8')),
    inventory: existsSync(inventoryPath) ? JSON.parse(readFileSync(inventoryPath, 'utf8')) : [],
  };
}
