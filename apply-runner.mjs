#!/usr/bin/env node
// apply-runner.mjs — background autonomous apply loop.
//
//   node apply-runner.mjs                       # one cycle over eligible targets
//   node apply-runner.mjs --limit 3             # cap jobs per cycle
//   node apply-runner.mjs --loop --interval 30  # repeat cycles every 30 min
//   node apply-runner.mjs --dry-run             # print the plan, spawn nothing
//
// WHAT CHANGED AND WHY
// --------------------
// 1. QUEUE PARSING. This file used to read `data/pipeline.md` with exactly one
//    regex requiring an em dash:
//
//      /^\s*- \[ \]\s+(https?:\/\/\S+)\s*—\s*(.+)$/
//
//    Measured against the real queue, 774 of 798 pending entries are the pipe
//    shape the scanners write (`- [ ] url | Company | Role | Location`), so the
//    runner saw 3 targets out of 20 and silently dropped the rest. That is the
//    main reason "the apply flow never gets through the list" — no amount of
//    retry logic downstream can fix a queue entry that was never read. Parsing
//    now lives in lib/job-queue.mjs, which understands both shapes (plus
//    freeform), dedupes by normalized URL, and skips `[x]`/`[!]` lines.
//
// 2. ALREADY-SUBMITTED TARGETS. A URL that `autofill.mjs` already confirmed and
//    marked `- [x]` can still be sitting in `data/last-found-jobs.json`, so it
//    gets filtered here too (`isPipelineDone`). Re-applying is the one mistake an
//    autonomous runner must never make.
//
// 3. NO CHILD LOGS. A failed child's output was printed and then lost, so the
//    only surviving evidence was one row in `data/apply-failures.tsv` with a
//    reason string. Every child's full output is now written to
//    `data/apply-runs/{date}-{company}-{hash}/runner.log`, next to the failure
//    artifacts `autofill.mjs` captures, so a failure can be read instead of
//    guessed at.
//
// Each job still runs as its OWN `node autofill.mjs <url>` child, so a wedged
// application can be SIGKILLed without losing the rest of the queue. The child
// deadline is derived from the watchdog config in config/profile.yml, and jobs
// with a recent failure in data/apply-failures.tsv are skipped while in
// cooldown.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { load as loadYaml } from 'js-yaml';
import { getCareerOpsRoot } from './path-resolver.mjs';
import { watchdogConfig, recordApplyFailure, recentFailureFor } from './lib/watchdog.mjs';
import { artifactSlug, applyRunsRoot } from './lib/failure-artifacts.mjs';
import { isPipelineDone, readJobQueue } from './lib/job-queue.mjs';
import { isMainModule } from './lib/is-main-module.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));

/**
 * Every queued target that still needs an application.
 *
 * Sources are combined by lib/job-queue.mjs (discovery output first because it
 * is freshest, then pending pipeline entries), and anything the pipeline already
 * records as `- [x]` is filtered out here.
 */
export function readTargets() {
  const root = getCareerOpsRoot();
  const queue = readJobQueue(root);
  const pipelinePath = resolve(root, 'data/pipeline.md');
  const targets = [];
  let alreadyDone = 0;
  for (const target of queue) {
    if (isPipelineDone(pipelinePath, target.url)) {
      alreadyDone++;
      continue;
    }
    targets.push(target);
  }
  if (alreadyDone) console.log(`  ⏭ ${alreadyDone} queued target(s) already marked submitted in data/pipeline.md; skipped.`);
  return targets;
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

/** Where this job's child output is written. Best-effort: never fatal. */
function runnerLogPath(target) {
  try {
    const dir = resolve(applyRunsRoot(getCareerOpsRoot()), artifactSlug({ company: target.company || target.name, url: target.url, reason: 'runner' }));
    mkdirSync(dir, { recursive: true });
    return resolve(dir, 'runner.log');
  } catch {
    return null;
  }
}

function spawnJob(target, deadlineMs) {
  const logPath = runnerLogPath(target);
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
      if (logPath) {
        try { writeFileSync(logPath, output, 'utf8'); } catch { /* logging must not fail the run */ }
      }
      resolveSpawn({ ...result, logPath });
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
    console.log('No pending targets found (data/last-found-jobs.json and data/pipeline.md contain no unreached openings).');
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
    if (result.logPath) console.log(`   log: ${result.logPath}`);
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

if (isMainModule(import.meta.url)) {
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
