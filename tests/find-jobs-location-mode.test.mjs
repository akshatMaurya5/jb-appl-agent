import test from 'node:test';
import assert from 'node:assert/strict';
import { locationMatchesMode } from '../find-jobs.mjs';

test('find-jobs defaults to roles outside India', () => {
  assert.equal(locationMatchesMode('Berlin, Germany'), true);
  assert.equal(locationMatchesMode('Remote — Worldwide'), true);
  assert.equal(locationMatchesMode('Bengaluru, India'), false);
  assert.equal(locationMatchesMode('Remote, India'), false);
});

test('find-jobs India mode includes only listings located in India', () => {
  assert.equal(locationMatchesMode('Bengaluru, India', 'india'), true);
  assert.equal(locationMatchesMode('Remote, India', 'india'), true);
  assert.equal(locationMatchesMode('Remote — Worldwide', 'india'), false);
  assert.equal(locationMatchesMode('Berlin, Germany', 'india'), false);
  assert.equal(locationMatchesMode('', 'india'), false);
});
