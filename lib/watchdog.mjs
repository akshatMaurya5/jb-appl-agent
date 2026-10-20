// Watchdog: hard time budgets per application job, kill-and-advance page
// handling, and the append-only apply-failures ledger. A stuck form must
// never block the queue — close its page, record the failure, move on.
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { localToday } from './local-today.mjs';

export const WATCHDOG_DEFAULTS = {
  job_timeout_seconds: 180, // pre-submit: fill + verify loop + find submit
  otp_poll_seconds: 120, // separate budget for the post-submit email-code wait
  confirm_deadline_seconds: 300, // post-submit confirmation polling window
  planner_timeout_seconds: 120, // native sub-agent planning cap
  cooldown_minutes: 60, // skip re-attempts of a recently failed job
};

const ENV_OVERRIDES = {
  job_timeout_seconds: 'CAREER_OPS_JOB_TIMEOUT_SECONDS',
  otp_poll_seconds: 'CAREER_OPS_OTP_POLL_SECONDS',
  confirm_deadline_seconds: 'CAREER_OPS_CONFIRM_DEADLINE_SECONDS',
  planner_timeout_seconds: 'CAREER_OPS_PLANNER_TIMEOUT_SECONDS',
  cooldown_minutes: 'CAREER_OPS_COOLDOWN_MINUTES',
};

export function watchdogConfig(profile = {}) {
  const config = { ...WATCHDOG_DEFAULTS };
  const fromProfile = profile?.raw?.autofill?.watchdog || {};
  for (const [key, defaultValue] of Object.entries(WATCHDOG_DEFAULTS)) {
    const profileValue = Number(fromProfile[key]);
    if (Number.isFinite(profileValue) && profileValue > 0) { config[key] = profileValue; continue; }
    const envValue = Number(process.env[ENV_OVERRIDES[key]]);
    if (Number.isFinite(envValue) && envValue > 0) config[key] = envValue;
    else config[key] = defaultValue;
  }
  return config;
}

export function raceWithDeadline(promise, ms) {
  if (!Number.isFinite(ms) || ms <= 0) return promise;
  let timer;
  return Promise.race([
    promise,
    new Promise(resolve => { timer = setTimeout(() => resolve('__watchdog_timeout__'), ms); }),
  ]).finally(() => clearTimeout(timer));
}

export async function killJobPage(page) {
  try {
    await page.close({ runBeforeUnload: false });
    console.log('  🔪 Closed the stuck application tab; the shared browser stays open for the next job.');
  } catch (error) {
    console.warn(`  ⚠ Could not close the stuck application tab: ${error.message}`);
  }
}

export function applyFailuresPath(root) { return resolve(root, 'data/apply-failures.tsv'); }

const FAILURE_COLUMNS = ['date', 'company', 'role', 'url', 'reason', 'phase', 'elapsed_ms', 'planner_available', 'epoch_ms'];

function tsvCell(value) {
  const text = String(value ?? '').replace(/\t/g, ' ').replace(/[\r\n]+/g, ' ').trim();
  return text.includes('"') ? text.replace(/"/g, '""') : text;
}

export function recordApplyFailure(root, { company = '', role = '', url = '', reason = '', phase = '', elapsedMs = 0, plannerAvailable = false } = {}) {
  const path = applyFailuresPath(root);
  const header = FAILURE_COLUMNS.join('\t');
  const row = [localToday(), company, role, url, reason, phase, elapsedMs, plannerAvailable ? '1' : '', Date.now()]
    .map(tsvCell).join('\t');
  try {
    if (!existsSync(path)) {
      mkdirSync(dirname(path), { recursive: true });
      appendFileSync(path, `${header}\n`);
    }
    appendFileSync(path, `${row}\n`);
    console.log(`  📒 Recorded apply failure: ${reason} (${phase || '?'}) for ${company || url || 'unknown'}.`);
    return path;
  } catch (error) {
    console.warn(`  ⚠ Could not record the apply failure: ${error.message}`);
    return null;
  }
}

export function recentFailureFor(root, { company = '', role = '', url = '' } = {}, cooldownMinutes = WATCHDOG_DEFAULTS.cooldown_minutes) {
  const path = applyFailuresPath(root);
  if (!existsSync(path)) return null;
  const lines = readFileSync(path, 'utf8').split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return null;
  const header = lines[0].split('\t');
  const columns = Object.fromEntries(FAILURE_COLUMNS.map(col => [col, header.indexOf(col)]));
  const normalized = value => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  let mostRecent = null;
  for (const line of lines.slice(1)) {
    const cells = line.split('\t');
    const cell = col => (columns[col] >= 0 ? cells[columns[col]] : '');
    const rowCompany = normalized(cell('company'));
    const rowRole = normalized(cell('role'));
    const rowUrl = cell('url');
    const matches = (url && rowUrl && rowUrl === url) ||
      (!url && company && rowCompany === normalized(company) && rowRole === normalized(role) && rowRole);
    if (!matches) continue;
    const epoch = Number(cell('epoch_ms'));
    if (!Number.isFinite(epoch) || epoch <= 0) continue;
    if (!mostRecent || epoch > mostRecent.epoch) {
      mostRecent = {
        epoch, date: cell('date'), company: cell('company'), role: cell('role'),
        url: rowUrl, reason: cell('reason'), phase: cell('phase'), elapsedMs: Number(cell('elapsed_ms')) || 0,
      };
    }
  }
  if (!mostRecent) return null;
  if (Date.now() - mostRecent.epoch > cooldownMinutes * 60 * 1000) return null;
  return mostRecent;
}
