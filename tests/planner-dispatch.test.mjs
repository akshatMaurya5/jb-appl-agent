import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PlannerUnavailableError } from '../lib/planner-dispatch.mjs';

// The dispatch tiers themselves spawn the host CLI or run a file handoff, so
// they are exercised in the supervised dry-runs; unit-test the contract that
// keeps callers honest: the error type signals "no native planner, do not
// guess" and is a real Error so callers' catch blocks degrade cleanly.
test('PlannerUnavailableError names the condition and is a real Error', () => {
  const error = new PlannerUnavailableError();
  assert.ok(error instanceof Error);
  assert.equal(error.name, 'PlannerUnavailableError');
  assert.match(error.message, /native sub-agent/i);
  assert.ok(new PlannerUnavailableError('custom detail').message.includes('custom detail'));
});
