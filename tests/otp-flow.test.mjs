import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runOtpFlow } from '../lib/otp-flow.mjs';

const fakeInput = label => ({ label, filled: [], async fill(value) { this.filled.push(value); } });
const farDeadline = () => Date.now() + 600000;

test('happy path: code arrives, verify activates, post-OTP follow-up confirms', async () => {
  const calls = { fetched: [], followedUp: 0, confirmed: 0 };
  const inputs = [fakeInput('box')];
  const result = await runOtpFlow({
    detectInputs: async () => inputs,
    fetchCode: async since => { calls.fetched.push(since); return { code: 'ABC123', source: 'mail' }; },
    enterCode: async (boxes, code) => { boxes[0].fill(code); return true; },
    clickVerify: async () => true,
    followUpSubmit: async () => { calls.followedUp++; return true; },
    isConfirmed: async () => { calls.confirmed++; return calls.confirmed >= 2; },
    company: 'Acme', submittedAt: 1000, confirmDeadlineMs: farDeadline(), sleepMs: 1,
  });
  assert.equal(result.status, 'entered');
  assert.equal(result.code, 'ABC123');
  assert.deepEqual(calls.fetched, [1000], 'single fetch when the first poll succeeds');
  assert.equal(calls.followedUp, 1, 'one follow-up submit before confirmation');
});

test('empty first poll triggers a resubmit and a second bounded poll', async () => {
  const calls = { fetched: [], followedUp: 0, log: [] };
  const inputs = [fakeInput('box')];
  const result = await runOtpFlow({
    detectInputs: async () => inputs,
    fetchCode: async since => { calls.fetched.push(since); calls.log.push('fetch'); return calls.fetched.length === 1 ? null : { code: 'DEF456', source: 'gmail-mcp' }; },
    enterCode: async () => true,
    clickVerify: async () => true,
    followUpSubmit: async () => { calls.followedUp++; calls.log.push('submit'); return true; },
    isConfirmed: async () => false,
    company: 'Acme', submittedAt: 1000, confirmDeadlineMs: farDeadline(), sleepMs: 1,
  });
  assert.equal(result.status, 'entered');
  assert.equal(calls.fetched.length, 2, 'two poll windows');
  assert.ok(calls.fetched[1] > 1000, 'second poll uses a fresh since-epoch after resubmit');
  assert.deepEqual(calls.log.slice(0, 3), ['fetch', 'submit', 'fetch'], 'resubmit sits between the two poll windows');
  assert.equal(calls.followedUp, 4, 'one resubmit between windows plus the 3 capped post-OTP follow-ups');
});

test('no-code when the deadline cannot fit a second poll window', async () => {
  const calls = { followedUp: 0 };
  const result = await runOtpFlow({
    detectInputs: async () => [fakeInput('box')],
    fetchCode: async () => null,
    enterCode: async () => true,
    clickVerify: async () => true,
    followUpSubmit: async () => { calls.followedUp++; return true; },
    isConfirmed: async () => false,
    company: 'Acme', submittedAt: 1000, otpPollSeconds: 120, confirmDeadlineMs: Date.now() + 5000, sleepMs: 1,
  });
  assert.equal(result.status, 'no-code');
  assert.equal(calls.followedUp, 0, 'no resubmit when the deadline is too close');
});

test('verify failure retries once with a fresh code after clearing the boxes', async () => {
  const calls = { fetched: [], activated: 0 };
  const inputs = [fakeInput('box')];
  const result = await runOtpFlow({
    detectInputs: async () => inputs,
    fetchCode: async () => { calls.fetched.push(1); return { code: calls.fetched.length === 1 ? 'OLD000' : 'NEW111', source: 'mail' }; },
    enterCode: async (boxes, code) => { boxes[0].fill(code); return true; },
    clickVerify: async () => { calls.activated++; return calls.activated >= 2; },
    followUpSubmit: async () => false,
    isConfirmed: async () => false,
    company: 'Acme', submittedAt: 1000, confirmDeadlineMs: farDeadline(), sleepMs: 1,
  });
  assert.equal(result.status, 'entered');
  assert.equal(result.attempt, 2);
  assert.equal(calls.fetched.length, 2, 'fresh code re-fetched for the retry');
  assert.deepEqual(inputs[0].filled, ['OLD000', '', 'NEW111'], 'boxes cleared between attempts');
});

test('widget re-render: re-detect once and re-enter before giving up on entry', async () => {
  const inputs = [fakeInput('box-a')];
  const reDetected = [fakeInput('box-b')];
  let detectCount = 0;
  const result = await runOtpFlow({
    detectInputs: async () => { detectCount++; return detectCount === 1 ? inputs : reDetected; },
    fetchCode: async () => ({ code: 'XYZ789', source: 'mail' }),
    enterCode: async (boxes, code) => { boxes[0].fill(code); return boxes === reDetected; },
    clickVerify: async () => true,
    followUpSubmit: async () => false,
    isConfirmed: async () => false,
    company: 'Acme', submittedAt: 1000, confirmDeadlineMs: farDeadline(), sleepMs: 1,
  });
  assert.equal(result.status, 'entered');
  assert.deepEqual(reDetected[0].filled, ['XYZ789'], 'second widget instance received the code');
});

test('no-code-inputs when the widget disappears after polling', async () => {
  const result = await runOtpFlow({
    detectInputs: async () => [],
    fetchCode: async () => ({ code: 'AAA111', source: 'mail' }),
    enterCode: async () => true,
    clickVerify: async () => true,
    followUpSubmit: async () => false,
    isConfirmed: async () => false,
    company: 'Acme', submittedAt: 1000, confirmDeadlineMs: farDeadline(), sleepMs: 1,
  });
  assert.equal(result.status, 'no-code-inputs');
});
