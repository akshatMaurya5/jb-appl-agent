import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mandatoryCoverageLoop, verifyRounds, DEFAULT_VERIFY_ROUNDS } from '../lib/form-verify.mjs';

const silentLog = { warn() {} };

test('converges as soon as mandatory coverage is complete', async () => {
  const fills = [];
  const missingByRound = [['A', 'B'], ['B'], []];
  const coverage = await mandatoryCoverageLoop({
    fill: round => fills.push(round),
    unresolved: () => missingByRound.shift(),
    log: silentLog,
  });
  assert.deepEqual(coverage, { ok: true, roundsUsed: 3, unresolved: [] });
  assert.deepEqual(fills, [1, 2, 3]);
});

test('stops after the rounds cap and reports the leftovers', async () => {
  let fills = 0;
  const coverage = await mandatoryCoverageLoop({
    fill: () => { fills++; },
    unresolved: () => ['stubborn field'],
    rounds: 3,
    log: silentLog,
  });
  assert.equal(coverage.ok, false);
  assert.equal(coverage.roundsUsed, 3);
  assert.equal(fills, 3);
  assert.deepEqual(coverage.unresolved, ['stubborn field']);
});

test('verifyRounds prefers profile config, then env, then the default', () => {
  assert.equal(verifyRounds({}), DEFAULT_VERIFY_ROUNDS);
  assert.equal(verifyRounds({ raw: { autofill: { watchdog: { verify_rounds: 5 } } } }), 5);
  assert.equal(verifyRounds({ raw: { autofill: { watchdog: { verify_rounds: 0 } } } }), DEFAULT_VERIFY_ROUNDS, 'invalid profile value falls back');
  process.env.CAREER_OPS_VERIFY_ROUNDS = '4';
  try {
    assert.equal(verifyRounds({}), 4);
  } finally {
    delete process.env.CAREER_OPS_VERIFY_ROUNDS;
  }
});
