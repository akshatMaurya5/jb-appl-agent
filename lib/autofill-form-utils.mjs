export function normalize(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function locationCityMatches(text, city) {
  const wanted = normalize(city);
  const actual = normalize(text);
  if (!wanted || !actual) return false;
  const aliases = wanted === 'bengaluru' ? ['bengaluru', 'bangalore'] :
    wanted === 'bangalore' ? ['bangalore', 'bengaluru'] : [wanted];
  return aliases.some(alias => actual === alias || actual.startsWith(`${alias} `) || actual.includes(` ${alias} `));
}

export function uniqueOptionMatch(matches) {
  return matches.length === 1 ? matches[0] : null;
}

export function uniqueLocationSuggestion(options, profile) {
  let matches = options.filter(option => locationCityMatches(option.text, profile.city));
  if (!matches.length) return null;

  for (const detail of [profile.state, profile.country].filter(Boolean)) {
    const detailedMatches = matches.filter(option => normalize(option.text).includes(normalize(detail)));
    if (detailedMatches.length) matches = detailedMatches;
  }
  return uniqueOptionMatch(matches);
}

// City-first combobox selection with a state → country fallback for boards
// whose suggestion list has no city entry (e.g. only "Karnataka, India").
// A non-unique country match is scoped by the city/state/target-city before
// giving up, so a list of many "X, India" entries still resolves when exactly
// one of them is the candidate's city (or the posting's city).
export function locationSuggestionWithFallback(options, profile, targetLocation = '') {
  const cityMatch = uniqueLocationSuggestion(options, profile);
  if (cityMatch) return { match: cityMatch, level: 'city' };
  const targetCity = String(targetLocation || '').split(/[,(]/)[0]?.trim();
  for (const [level, detail] of [['state', profile.state], ['country', profile.country]]) {
    if (!detail) continue;
    let matches = options.filter(option => normalize(option.text).includes(normalize(detail)));
    if (matches.length > 1) {
      const scoped = matches.filter(option =>
        (profile.city && locationCityMatches(option.text, profile.city)) ||
        (profile.state && normalize(option.text).includes(normalize(profile.state))) ||
        (targetCity && normalize(option.text).includes(normalize(targetCity))));
      if (scoped.length === 1) return { match: scoped[0], level: `${level} (scoped)` };
      if (scoped.length) matches = scoped;
    }
    const unique = uniqueOptionMatch(matches);
    if (unique) return { match: unique, level };
  }
  return null;
}

export function isRegisteredLocationSelection(rawSelection, profile) {
  if (!rawSelection) return false;
  let selection;
  try {
    selection = JSON.parse(rawSelection);
  } catch {
    return false;
  }
  if (!selection || typeof selection !== 'object' || !selection.id || selection.id === 'loc-custom') return false;
  const selectedName = [selection.name, selection.label, selection.text, selection.city, selection.formattedAddress]
    .filter(Boolean).join(' ');
  if (!locationCityMatches(selectedName, profile.city)) return false;
  const selectedCountry = selection.country?.name || selection.country || '';
  return !profile.country || !selectedCountry || normalize(selectedCountry) === normalize(profile.country);
}

export function selectedValueMatches(actual, expected) {
  return String(actual ?? '') === String(expected ?? '');
}

// A combobox may render the chosen label with a dial code, flag glyph, or
// different punctuation than the option text (e.g. option "India +91" lands
// in the control as "India"). Accept an exact match, or containment once the
// shorter side is a meaningful label (>= 6 chars), after trailing dial codes
// are stripped.
export function registeredOptionMatches(actual, expected) {
  const strip = text => normalize(text).replace(/(?:\+?\d{1,4})(?:\s*\d{1,4})*$/, '').trim();
  const a = strip(actual);
  const e = strip(expected);
  if (!a || !e) return false;
  if (a === e) return true;
  const [shorter, longer] = a.length < e.length ? [a, e] : [e, a];
  return shorter.length >= 6 && longer.includes(shorter);
}

export function isPlaceholderChoice(value, text = '') {
  const label = normalize(text || value);
  return !label || /^(?:select(?: one| an? .*)?|please (?:select|choose)(?: one| an? .*)?|choose(?: one| an? .*)?|click here|not selected|--+)$/.test(label);
}
