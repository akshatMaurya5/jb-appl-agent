import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  watchdogConfig, raceWithDeadline, killJobPage, applyFailuresPath,
  recordApplyFailure, recentFailureFor, WATCHDOG_DEFAULTS,
} from '../lib/watchdog.mjs';

test('watchdogConfig: profile beats env beats defaults; invalid values fall back', () => {
  const profile = { raw: { autofill: { watchdog: { job_timeout_seconds: 90 } } } };
  assert.equal(watchdogConfig(profile).job_timeout_seconds, 90, 'profile value wins');
  assert.equal(watchdogConfig(profile).otp_poll_seconds, WATCHDOG_DEFAULTS.otp_poll_seconds, 'missing key uses default');
  process.env.CAREER_OPS_JOB_TIMEOUT_SECONDS = '150';
  try {
    assert.equal(watchdogConfig({}).job_timeout_seconds, 150, 'env override when profile silent');
  } finally {
    delete process.env.CAREER_OPS_JOB_TIMEOUT_SECONDS;
  }
  assert.equal(watchdogConfig({ raw: { autofill: { watchdog: { job_timeout_seconds: -5 } } } }).job_timeout_seconds, WATCHDOG_DEFAULTS.job_timeout_seconds, 'invalid value falls back');
});

test('raceWithDeadline resolves the task before the deadline and times out after it', async () => {
  assert.equal(await raceWithDeadline(Promise.resolve('done'), 1000), 'done');
  assert.equal(await raceWithDeadline(new Promise(() => {}), 40), '__watchdog_timeout__');
  assert.equal(await raceWithDeadline(Promise.resolve('x'), 0), 'x', 'non-positive budget disables the race');
});

test('killJobPage closes the page without running beforeunload', async () => {
  const calls = [];
  const page = { close: async options => { calls.push(options); } };
  await killJobPage(page);
  assert.deepEqual(calls, [{ runBeforeUnload: false }]);
  await killJobPage({ close: async () => { throw new Error('already closed'); } }, 'does not throw on a dead page');
});

test('recordApplyFailure appends a header then rows; recentFailureFor honors cooldown', () => {
  const root = mkdtempSync(join(tmpdir(), 'watchdog-'));
  try {
    const path = applyFailuresPath(root);
    recordApplyFailure(root, { company: 'Acme', role: 'SWE', url: 'https://a.test/job', reason: 'job-timeout', phase: 'fill', elapsedMs: 180000, plannerAvailable: true });
    recordApplyFailure(root, { company: 'Beta', role: 'PM', url: 'https://b.test/job', reason: 'no-form', phase: 'fill' });
    const lines = readFileSync(path, 'utf8').trim().split('\n');
    assert.equal(lines.length, 3);
    assert.ok(lines[0].startsWith('date\tcompany\trole\turl\treason\tphase\telapsed_ms\tplanner_available\tepoch_ms'));
    assert.ok(lines[1].includes('job-timeout\tfill\t180000\t1\t'), 'row carries reason, phase, elapsed, planner flag, epoch');
    const recent = recentFailureFor(root, { company: 'Acme', role: 'SWE' }, 60);
    assert.ok(recent && recent.reason === 'job-timeout', 'recent failure within cooldown is found');
    assert.equal(recentFailureFor(root, { company: 'Acme', role: 'SWE' }, 0), null, 'expired cooldown misses');
    assert.equal(recentFailureFor(root, { company: 'Acme', role: 'PM' }, 60), null, 'different role at the same company is not a match');
    assert.equal(recentFailureFor(root, { url: 'https://b.test/job' }, 60).reason, 'no-form', 'url key matches');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
