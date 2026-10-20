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
export function locationSuggestionWithFallback(options, profile) {
  const cityMatch = uniqueLocationSuggestion(options, profile);
  if (cityMatch) return { match: cityMatch, level: 'city' };
  for (const [level, detail] of [['state', profile.state], ['country', profile.country]]) {
    if (!detail) continue;
    const matches = options.filter(option => normalize(option.text).includes(normalize(detail)));
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

export function isPlaceholderChoice(value, text = '') {
  const label = normalize(text || value);
  return !label || /^(?:select(?: one| an? .*)?|please (?:select|choose)(?: one| an? .*)?|choose(?: one| an? .*)?|click here|not selected|--+)$/.test(label);
}
