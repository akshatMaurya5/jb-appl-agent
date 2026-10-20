#!/usr/bin/env node
// apply-runner.mjs — background autonomous apply loop.
//
//   node apply-runner.mjs                     # one cycle over eligible targets
//   node apply-runner.mjs --limit 3           # cap jobs per cycle
//   node apply-runner.mjs --loop --interval 30  # repeat cycles every 30 min
//   node apply-runner.mjs --dry-run           # print the plan, spawn nothing
//
// Targets come from data/last-found-jobs.json (the latest discovery batch)
// and the Pending section of data/pipeline.md. Each job runs as its OWN
// `node autofill.mjs <url>` child so a wedged application can be SIGKILLed
// without losing the rest of the queue. The per-job child deadline is
// derived from the watchdog config in config/profile.yml; jobs with a
// recent failure in data/apply-failures.tsv are skipped while in cooldown.
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { load as loadYaml } from 'js-yaml';
import { getCareerOpsRoot } from './path-resolver.mjs';
import { watchdogConfig, recordApplyFailure, recentFailureFor } from './lib/watchdog.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
export function readTargets() {
  const targets = [];
  const foundPath = resolve(getCareerOpsRoot(), 'data/last-found-jobs.json');
  if (existsSync(foundPath)) {
    try {
      const found = JSON.parse(readFileSync(foundPath, 'utf8'));
      if (Array.isArray(found)) {
        for (const job of found) {
          if (!job?.url) continue;
          targets.push({ name: job.name || job.company || 'Job', company: job.company || job.name || '', role: job.role || job.title || '', url: job.url });
        }
      }
    } catch (error) {
      console.warn(`  ⚠ Could not read ${foundPath}: ${error.message}`);
    }
  }
  const pipelinePath = resolve(getCareerOpsRoot(), 'data/pipeline.md');
  if (existsSync(pipelinePath)) {
    const source = readFileSync(pipelinePath, 'utf8');
    for (const line of source.split(/\r?\n/)) {
      const match = line.match(/^\s*- \[ \]\s+(https?:\/\/\S+)\s*—\s*(.+)$/);
      if (!match) continue;
      const description = match[2].split('(');
      const company = description[0].trim();
      const role = description.length > 1 ? description.slice(1).join('(').replace(/\)\s*$/, '').trim() : '';
      targets.push({ name: company || match[1], company, role, url: match[1] });
    }
  }
  const seen = new Set();
  return targets.filter(target => (seen.has(target.url) ? false : (seen.add(target.url), true)));
}

function profileForBudget() {
  const profilePath = resolve(getCareerOpsRoot(), 'config/profile.yml');
  if (!existsSync(profilePath)) return {};
  try {
    return { raw: loadYaml(readFileSync(profilePath, 'utf8')) };
  } catch (error) {
    console.warn(`  ⚠ Could not read the profile for watchdog config (${error.message}); using defaults.`);
    return {};
  }
}

function childDeadlineMs(watchdog) {
  // Two OTP poll windows plus the confirmation window plus slack for the
  // fill preflight and the verify loop.
  return (watchdog.job_timeout_seconds + watchdog.otp_poll_seconds * 2 + watchdog.confirm_deadline_seconds + 60) * 1000;
}

function spawnJob(target, deadlineMs) {
  return new Promise((resolveSpawn) => {
    const child = spawn(process.execPath, ['autofill.mjs', target.url], {
      cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], env: process.env,
    });
    let output = '';
    let finished = false;
    const finish = (result) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      resolveSpawn(result);
    };
    const timer = setTimeout(() => {
      console.warn(`  🔪 Runner watchdog: killing the stuck child for ${target.name || target.url} after ${Math.round(deadlineMs / 60000)} min.`);
      child.kill('SIGKILL');
      finish({ outcome: 'timeout', output });
    }, deadlineMs);
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { output += chunk; });
    child.on('error', error => finish({ outcome: 'error', output: `${output}\n${error.message}` }));
    child.on('close', code => finish({ outcome: code === 0 ? 'ok' : 'failed', code, output }));
  });
}

async function runCycle({ limit, dryRun }) {
  const targets = readTargets();
  if (!targets.length) {
    console.log('No pending targets found (data/last-found-jobs.json and data/pipeline.md are both empty of URLs).');
    return { attempted: 0, skipped: 0, failed: 0, timedOut: 0, exhausted: true };
  }
  const watchdog = watchdogConfig(profileForBudget());
  const deadlineMs = childDeadlineMs(watchdog);
  const budget = targets.slice(0, limit ?? targets.length);
  console.log(`Apply cycle: ${budget.length} of ${targets.length} target(s); per-job child budget ${Math.round(deadlineMs / 60000)} min; cooldown ${watchdog.cooldown_minutes} min.`);
  let attempted = 0, skipped = 0, failed = 0, timedOut = 0;
  for (const target of budget) {
    const recent = recentFailureFor(getCareerOpsRoot(), { company: target.company, role: target.role, url: target.url }, watchdog.cooldown_minutes);
    if (recent) {
      console.log(`  ⏭ Skipping ${target.name || target.url}: in cooldown (${recent.reason}, ${recent.date}).`);
      skipped++;
      continue;
    }
    if (dryRun) {
      console.log(`  [dry-run] Would apply: ${target.name || target.company} — ${target.role || ''} (${target.url})`);
      continue;
    }
    const started = Date.now();
    console.log(`\n▶ Applying to ${target.name || target.company} — ${target.role || ''}\n   ${target.url}`);
    const result = await spawnJob(target, deadlineMs);
    const elapsedMs = Date.now() - started;
    if (result.outcome === 'ok') {
      attempted++;
      console.log(`  ✔ Child reported success for ${target.name || target.url}.`);
    } else if (result.outcome === 'timeout') {
      timedOut++;
      recordApplyFailure(getCareerOpsRoot(), {
        company: target.company, role: target.role, url: target.url,
        reason: 'runner-timeout', phase: 'runner', elapsedMs,
      });
    } else if (/no eligible targets/i.test(result.output)) {
      console.log(`  ⏭ Tracker gate: ${target.name || target.url} is no longer eligible; skipped.`);
      skipped++;
    } else {
      failed++;
      recordApplyFailure(getCareerOpsRoot(), {
        company: target.company, role: target.role, url: target.url,
        reason: 'child-error', phase: 'runner', elapsedMs,
      });
      console.warn(`  ⚠ Child failed for ${target.name || target.url}: ${(result.output || '').split('\n').slice(-3).join(' ').slice(0, 200)}`);
    }
  }
  return { attempted, skipped, failed, timedOut, exhausted: budget.length === targets.length && failed === 0 && timedOut === 0 };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = process.argv.slice(2);
  const flag = name => args.includes(`--${name}`);
  const valueAfter = name => {
    const index = args.indexOf(`--${name}`);
    return index >= 0 ? args[index + 1] : undefined;
  };
  const dryRun = flag('dry-run');
  const loop = flag('loop');
  const intervalMinutes = Number(valueAfter('interval')) || 30;
  const limit = Number(valueAfter('limit')) || undefined;

  if (dryRun) console.log('Dry run — no autofill children will be spawned.\n');

  const sleep = minutes => new Promise(resolve => setTimeout(resolve, minutes * 60 * 1000));

  let cycle = 0;
  for (;;) {
    cycle++;
    const summary = await runCycle({ limit, dryRun });
    if (!loop || summary.exhausted) {
      console.log(`\nCycle ${cycle} done: ${summary.attempted} attempted, ${summary.skipped} skipped, ${summary.failed} failed, ${summary.timedOut} timed out.`);
      break;
    }
    console.log(`\nCycle ${cycle} done: ${summary.attempted} attempted, ${summary.skipped} skipped. Sleeping ${intervalMinutes} min before the next cycle.`);
    await sleep(intervalMinutes);
  }
}
