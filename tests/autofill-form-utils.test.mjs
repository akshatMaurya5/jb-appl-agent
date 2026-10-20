import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isPlaceholderChoice,
  isRegisteredLocationSelection,
  selectedValueMatches,
  uniqueLocationSuggestion,
  uniqueOptionMatch,
} from '../lib/autofill-form-utils.mjs';

test('option matching proceeds only when the choice is unique', () => {
  const one = { text: 'India', value: 'IN' };
  assert.equal(uniqueOptionMatch([one]), one);
  assert.equal(uniqueOptionMatch([]), null);
  assert.equal(uniqueOptionMatch([one, one]), null);
});

test('location suggestions are disambiguated using the candidate state and country', () => {
  const options = [
    { text: 'Bengaluru, Karnataka, India', index: 0 },
    { text: 'Bengaluru, California, United States', index: 1 },
  ];
  assert.deepEqual(uniqueLocationSuggestion(options, {
    city: 'Bengaluru',
    state: 'Karnataka',
    country: 'India',
  }), options[0]);
});

test('ambiguous or unrelated location suggestions do not get selected', () => {
  assert.equal(uniqueLocationSuggestion([
    { text: 'Bengaluru, India', index: 0 },
    { text: 'Bengaluru, United States', index: 1 },
  ], { city: 'Bengaluru' }), null);
  assert.equal(uniqueLocationSuggestion([
    { text: 'London, United Kingdom', index: 0 },
  ], { city: 'Bengaluru', country: 'India' }), null);
});

test('registered location must be a real selection for the profile city', () => {
  const profile = { city: 'Bengaluru', country: 'India' };
  assert.equal(isRegisteredLocationSelection(
    JSON.stringify({ id: 'place-1', name: 'Bengaluru, Karnataka, India', country: 'India' }),
    profile,
  ), true);
  assert.equal(isRegisteredLocationSelection('Bengaluru, Karnataka, India', profile), false);
  assert.equal(isRegisteredLocationSelection(
    JSON.stringify({ id: 'loc-custom', name: 'Bengaluru, Karnataka, India' }),
    profile,
  ), false);
  assert.equal(isRegisteredLocationSelection(
    JSON.stringify({ id: 'place-2', name: 'Bengaluru, California, United States', country: 'United States' }),
    profile,
  ), false);
});

test('selected control values must exactly match the requested option value', () => {
  assert.equal(selectedValueMatches('IN', 'IN'), true);
  assert.equal(selectedValueMatches('India', 'IN'), false);
});

test('select placeholders are not treated as completed answers', () => {
  assert.equal(isPlaceholderChoice('', 'Select one'), true);
  assert.equal(isPlaceholderChoice('choose', 'Please choose a country'), true);
  assert.equal(isPlaceholderChoice('country-india', 'India'), false);
});
