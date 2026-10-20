import { test } from 'node:test';
import assert from 'node:assert/strict';
import { enterVerificationCode } from '../lib/otp-entry.mjs';

function makeInputs(count, { distributeTypedCode = false } = {}) {
  const values = Array(count).fill('');
  let focused = 0;
  return values.map((_, index) => ({
    async click() { focused = index; },
    async fill(value) {
      values[index] = value;
      focused = index;
    },
    async inputValue() { return values[index]; },
    async pressSequentially(value) {
      for (const char of value) {
        if (distributeTypedCode) {
          if (focused < values.length) values[focused++] = char;
        } else {
          values[index] = `${values[index]}${char}`.slice(0, 1);
        }
      }
    },
  }));
}

test('enters and verifies a single-field verification code', async () => {
  const inputs = makeInputs(1);
  assert.equal(await enterVerificationCode(inputs, '012345'), true);
  assert.equal(await inputs[0].inputValue(), '012345');
});

test('types a code into widgets that auto-advance across segmented fields', async () => {
  const inputs = makeInputs(6, { distributeTypedCode: true });
  assert.equal(await enterVerificationCode(inputs, '012345'), true);
  assert.deepEqual(await Promise.all(inputs.map(input => input.inputValue())), ['0', '1', '2', '3', '4', '5']);
});

test('falls back to per-box entry and verifies every segmented character', async () => {
  const inputs = makeInputs(6);
  assert.equal(await enterVerificationCode(inputs, '012345'), true);
  assert.deepEqual(await Promise.all(inputs.map(input => input.inputValue())), ['0', '1', '2', '3', '4', '5']);
});

test('does not enter a segmented code with a mismatched input count', async () => {
  const inputs = makeInputs(5);
  assert.equal(await enterVerificationCode(inputs, '012345'), false);
  assert.deepEqual(await Promise.all(inputs.map(input => input.inputValue())), ['', '', '', '', '']);
});

test('rejects an empty code or a code that did not persist in the widget', async () => {
  assert.equal(await enterVerificationCode(makeInputs(1), ''), false);
  const broken = [{ async fill() {}, async inputValue() { return ''; }, async click() {}, async pressSequentially() {} }];
  assert.equal(await enterVerificationCode(broken, '123456'), false);
});
