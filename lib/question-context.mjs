// question-context.mjs — turn raw Playwright DOM text into a readable question.
//
// WHY THIS EXISTS
// ---------------
// autofill.mjs used to build a control's "question" by concatenating every
// string it could find around the control:
//
//   aria-label + placeholder + name + id + labels + wrapper.innerText
//
// On boards that render a custom component (Greenhouse's "Type here..." inputs,
// Ashby's UUID-named fields, Lever's `urls[portfolio]`) the concatenation
// produced things like:
//
//   "type here... f1d7e277-0c8f-4ff9-87d1-3d17914a8063 f1d7e277-..."
//   "start typing... question_38511204002 are you authorised to work in germany?*"
//
// That string is then used as the *question* everywhere downstream:
//   - templates/form-categories.yml patterns (regex) cannot match it,
//   - lib/application-faq.mjs similarity cannot match it,
//   - the form planner receives it as the question to answer.
//
// Measured against the real 3.4 MB FAQS.md question bank, "start typing..." was
// the single most common unanswered question (25 occurrences) and UUID-prefixed
// labels filled most of the rest. Those are not hard questions — they are
// unreadable questions, and every answer tier failed for the same reason.
//
// This module keeps the DOM collection (which sources to read, in which
// priority order) and the cleanup separate from the page, so both are testable
// without a browser.
//
// WHAT IT DOES NOT DO
// -------------------
// It never invents a question. If every source is a placeholder, it returns ''
// and the caller must treat the field as "unreadable" (report it, do not ask a
// planner to answer a question nobody can read).

/** Longest question string handed to a classifier or a planner. */
export const MAX_QUESTION_CHARS = 400;

const UUID_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const LONG_HEX_RE = /\b[0-9a-f]{16,}\b/gi;
// "start typing...", "Start typing…", "type here...", "begin typing"
const PLACEHOLDER_RE = /\b(?:start|begin)\s+typing\s*(?:\.{2,3}|…)?|\btype\s+here\s*(?:\.{2,3}|…)?/gi;
// question_38438291002 / question-1234 / sysfield_abc / field_123456
const ATS_ID_RE = /\b(?:question|sys_?field|systemfield|input|field)[_-]?\d{4,}\b/gi;
const ATS_NAME_RE = /\b_sys(?:tem)?field[_\w-]*/gi;
// Greenhouse/Lever file-named URL fields: urls[portfolio] -> "portfolio"
const URL_NAME_RE = /\burls?\[([^\]]*)\]/gi;
// Invisible formatting characters that show up inside innerText.
const INVISIBLE_RE = /[\u200b-\u200d\ufeff\u00a0]/g;

function dedupeRepeatedSegments(text) {
  const segments = text.split(/(?<=[?.!:;])\s+/);
  const seen = new Set();
  const kept = [];
  for (const segment of segments) {
    const key = segment.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    if (!key) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(segment.trim());
  }
  return kept.join(' ');
}

/**
 * Strip the machine noise a custom form component puts into its own label.
 * `urls[portfolio]` is kept (as the word "portfolio") because it IS the only
 * hint the control gives about what it wants.
 */
export function stripQuestionNoise(raw) {
  if (!raw) return '';
  let text = String(raw);
  text = text.replace(URL_NAME_RE, (_match, inner) => ` ${String(inner).replace(/[_-]+/g, ' ')} `);
  text = text.replace(INVISIBLE_RE, ' ');
  text = text.replace(UUID_RE, ' ');
  text = text.replace(ATS_ID_RE, ' ');
  text = text.replace(ATS_NAME_RE, ' ');
  text = text.replace(LONG_HEX_RE, ' ');
  text = text.replace(PLACEHOLDER_RE, ' ');
  text = text.replace(/\s+/g, ' ').trim();
  text = text.replace(/^[\s,;:|./-]+/, '').trim();
  return dedupeRepeatedSegments(text);
}

/** True when nothing but placeholders/ids was in the source string. */
export function isUnreadableQuestion(question) {
  return !stripQuestionNoise(question);
}

export function clampQuestion(question, max = MAX_QUESTION_CHARS) {
  const text = String(question || '').trim();
  return text.length <= max ? text : text.slice(0, max).trim();
}

/**
 * Build the question from every source read off the control, in trust order.
 *
 * High-trust sources (a real <label>, a fieldset <legend>, aria-labelledby)
 * come first. Wrapper text stays in the string — several existing rules depend
 * on a sibling label being visible (the phone-number vs phone-country split,
 * the location autocomplete detection) — but it can no longer decide the whole
 * question, and all of it is noise-stripped afterwards.
 *
 * placeholders/name/id are appended LAST and only used when nothing better
 * survived, so `urls[portfolio]` still answers "what is this field" for a
 * control that has no label at all.
 */
export function buildQuestionContext({
  labels = [],
  legends = [],
  wrapper = '',
  placeholder = '',
  name = '',
  id = '',
} = {}) {
  const highTrust = [...labels, ...legends]
    .map(value => String(value || '').replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  const highTrustText = stripQuestionNoise(highTrust.join(' '));
  const wrapperText = stripQuestionNoise(wrapper);

  // Labels + wrapper is the normal case and the most informative.
  const combined = stripQuestionNoise([highTrust.join(' '), wrapper].filter(Boolean).join(' '));
  if (combined.length >= 3) {
    // Keep the label first even after dedupe/merge.
    const ordered = highTrustText && !combined.startsWith(highTrustText.slice(0, 12))
      ? stripQuestionNoise(`${highTrust.join(' ')} ${combined}`)
      : combined;
    return clampQuestion(ordered);
  }
  if (wrapperText.length >= 3) return clampQuestion(wrapperText);

  const fallback = stripQuestionNoise([placeholder, name, id].filter(Boolean).join(' '));
  if (fallback.length >= 3) return clampQuestion(fallback);
  // name/id alone can still carry meaning (`urls[portfolio]` -> "portfolio").
  const attributeHint = stripQuestionNoise([name, id].filter(Boolean).join(' '));
  return clampQuestion(attributeHint.length >= 2 ? attributeHint : '');
}

/** Stable cache key for a question — used by intent caching. */
export function questionKey(question) {
  return String(question || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Fingerprint of a question's *shape* with the domain nouns removed, so two
 * wordings of one intent can be compared even when they share no vocabulary.
 * "How did you hear about Acme?" and "Where did you first learn of Acme?"
 * both reduce to {hear|learn, order-independent}.
 */
export function questionTokens(question) {
  return questionKey(question)
    .split(' ')
    .filter(token => token.length > 2);
}
