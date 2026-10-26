// answer-render.mjs — the cross-representation answer layer.
//
// WHY THIS EXISTS
// ---------------
// A stored application answer used to be a single string rendered for the one
// control it was first typed into. That works only while the next form asks the
// same question with the same control type. The moment the same question shows
// up as a dropdown ("How did you hear about us? [Career site | Job board | …]")
// or as a radio group, the stored free text no longer fits, and vice versa: an
// option label ("Company career site") was pasted into a text input as-is.
//
// So an answer is modelled as a TYPED canonical value plus the ways it has been
// expressed:
//
//   { answer_type: 'enum',  canonical_value: 'referral:company_career_page' }
//   { answer_type: 'boolean', canonical_value: true }
//   { answer_type: 'number', canonical_value: 50000, unit: 'salary' }
//   { answer_type: 'text',  canonical_value: 'Company Career Page' }
//
// `renderAnswer()` then projects that value into whatever control is on screen:
//
//   boolean   -> radio/select  "Yes" / "No"        (polarity-aware)
//             -> text input    "Yes"
//   number    -> option band   "50k - 70k"         (salary / YOE / notice band)
//             -> text input    "50000"
//   enum/text -> select option chosen by meaning   (option-matching aliases)
//             -> text input    the human surface string
//   long_text -> textarea only; NEVER a choice control
//
// The refusals are typed on purpose (`essay-not-choice`, `choice-not-listed`,
// `ambiguous-option`) so the apply ledger can record *why* a field stayed
// empty instead of collapsing every cause into one opaque reason.
import {
  matchOptions, normalize, optionPolarity, salaryBandBounds, salaryBandContains,
} from './option-matching.mjs';

export const ANSWER_TYPES = Object.freeze({
  BOOLEAN: 'boolean',
  ENUM: 'enum',
  NUMBER: 'number',
  TEXT: 'text',
  LONG_TEXT: 'long_text',
  MULTI: 'multi',
});

export const REFUSAL = Object.freeze({
  NO_ANSWER: 'no-answer',
  ESSAY_NOT_CHOICE: 'essay-not-choice',
  CHOICE_NOT_LISTED: 'choice-not-listed',
  AMBIGUOUS_OPTION: 'ambiguous-option',
  UNSUPPORTED_CONTROL: 'unsupported-control',
});

const CHOICE_CONTROLS = new Set(['select', 'radio', 'combobox', 'radio-group']);
const TEXT_CONTROLS = new Set(['text', 'textarea', 'number', 'email', 'tel', 'url', 'date', 'input']);
const MULTI_CONTROLS = new Set(['checkbox-group', 'multi', 'multi-select']);

const LONG_TEXT_MIN_WORDS = 25;
const LONG_TEXT_MIN_CHARS = 180;

const YES_TOKENS = new Set(['yes', 'y', 'true', 'yep', 'yeah', 'i do', 'i have', 'i am', 'i will', 'affirmative']);
const NO_TOKENS = new Set(['no', 'n', 'false', 'nope', 'nah', 'i do not', 'i have not', 'i am not', 'i will not', 'negative']);

function words(value) {
  return String(value || '').trim().split(/\s+/).filter(Boolean);
}

export function isEssayLike(value) {
  const text = String(value || '').trim();
  if (!text) return false;
  if (text.length >= LONG_TEXT_MIN_CHARS) return true;
  const count = words(text).length;
  return count >= LONG_TEXT_MIN_WORDS || (count >= 12 && /[.!?]\s+\S/.test(text));
}

/** Boolean reading of a yes/no answer, or null when it is not one. */
export function readBoolean(value) {
  const text = normalize(value).replace(/[.!,]+$/g, '').trim();
  if (!text) return null;
  if (YES_TOKENS.has(text)) return true;
  if (NO_TOKENS.has(text)) return false;
  const polarity = optionPolarity(text);
  if (polarity === 'yes') return true;
  if (polarity === 'no') return false;
  return null;
}

/** "30 days" / "1 month" / "4 weeks" / "immediate" -> days, or null. */
export function readDurationDays(value) {
  const text = normalize(value);
  if (!text) return null;
  if (/^(?:immediate|immediately|asap|right away|now)$/.test(text)) return 0;
  const match = text.match(/(\d+(?:\.\d+)?)\s*(day|days|week|weeks|month|months)/);
  if (!match) return null;
  const amount = Number(match[1]);
  const unit = match[2];
  if (!Number.isFinite(amount)) return null;
  if (/^day/.test(unit)) return Math.round(amount);
  if (/^week/.test(unit)) return Math.round(amount * 7);
  return Math.round(amount * 30);
}

const CURRENCY_HINTS = [
  [/₹|inr|rs\.?|rupee/i, 'INR'],
  [/\$|usd|dollar/i, 'USD'],
  [/€|eur|euro/i, 'EUR'],
  [/£|gbp|pound/i, 'GBP'],
];

function readCurrency(value, context) {
  const haystack = `${value} ${context}`;
  for (const [pattern, code] of CURRENCY_HINTS) if (pattern.test(haystack)) return code;
  return '';
}

/** "50000" / "5 LPA" / "60k" / "$120,000" -> {amount, currency, period}. */
export function readSalary(value, context = '') {
  const text = String(value || '').trim();
  if (!text) return null;
  const lpa = text.match(/(\d+(?:\.\d+)?)\s*(?:lpa|lakh|lac|lacs)/i);
  if (lpa) {
    return {
      amount: Math.round(Number(lpa[1]) * 100_000),
      currency: 'INR',
      period: 'year',
    };
  }
  const money = text.match(/(\d[\d,.]*)\s*(k|thousand)?/i);
  if (!money) return null;
  let amount = Number(String(money[1]).replace(/,/g, ''));
  if (!Number.isFinite(amount)) return null;
  if (String(money[2] || '').toLowerCase() === 'k' || /thousand/i.test(money[2] || '')) amount *= 1000;
  const perMonth = /\b(?:per month|monthly|\/month|\/mo|pm)\b/i.test(`${text} ${context}`);
  return {
    amount: Math.round(amount),
    currency: readCurrency(text, context),
    period: perMonth ? 'month' : 'year',
  };
}

function readNumber(value) {
  const match = String(value ?? '').match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const number = Number(match[0]);
  return Number.isFinite(number) ? number : null;
}

/**
 * Work out what kind of answer this value is. The control context disambiguates:
 * a 25-word paragraph on a textarea question is long_text; the same paragraph
 * on a radio group can only be a mistake.
 */
export function inferAnswerType(value, { inputType = '', options = [], context = '' } = {}) {
  const text = String(value ?? '').trim();
  if (!text) return ANSWER_TYPES.TEXT;

  const lowered = normalize(context);
  const hasOptions = Array.isArray(options) && options.length > 0;
  const salaryish = /salary|compensation|ctc|package|remuneration/.test(lowered);
  const noticeish = /notice period|availability|earliest start|start date|how soon/.test(lowered);
  const yoeish = /years?\b.{0,30}\bexperience|experience.{0,20}\byears?\b|\byoe\b/.test(lowered);

  if (salaryish && readSalary(text, context)) return ANSWER_TYPES.NUMBER;
  if (noticeish && readDurationDays(text) !== null) return ANSWER_TYPES.NUMBER;
  if (yoeish && readNumber(text) !== null) return ANSWER_TYPES.NUMBER;
  if (readBoolean(text) !== null && (hasOptions || /^(?:yes|no|true|false)$/i.test(text))) return ANSWER_TYPES.BOOLEAN;
  if (isEssayLike(text)) return ANSWER_TYPES.LONG_TEXT;
  if (hasOptions && inputType === 'select') return ANSWER_TYPES.ENUM;
  if (inputType === 'number') return ANSWER_TYPES.NUMBER;
  return ANSWER_TYPES.TEXT;
}

/**
 * Convert a raw stored/profile answer into `{ answer_type, canonical_value, display }`.
 * This is the value half of the FAQ record; `intent` lives on the record itself.
 */
export function canonicalizeAnswer(value, { inputType = '', options = [], context = '' } = {}) {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  const answerType = inferAnswerType(raw, { inputType, options, context });

  if (answerType === ANSWER_TYPES.BOOLEAN) {
    const boolean = readBoolean(raw);
    return {
      answer_type: ANSWER_TYPES.BOOLEAN,
      canonical_value: boolean,
      display: boolean ? 'Yes' : 'No',
      unit: '',
      raw,
    };
  }

  if (answerType === ANSWER_TYPES.NUMBER) {
    const lowered = normalize(context);
    if (/salary|compensation|ctc|package|remuneration/.test(lowered)) {
      const salary = readSalary(raw, context);
      if (salary) {
        return {
          answer_type: ANSWER_TYPES.NUMBER,
          canonical_value: salary,
          display: raw,
          unit: 'salary',
          raw,
        };
      }
    }
    if (/notice period|availability|earliest start|start date|how soon/.test(lowered)) {
      const days = readDurationDays(raw);
      if (days !== null) {
        return {
          answer_type: ANSWER_TYPES.NUMBER,
          canonical_value: days,
          display: raw,
          unit: 'duration_days',
          raw,
        };
      }
    }
    return {
      answer_type: ANSWER_TYPES.NUMBER,
      canonical_value: readNumber(raw) ?? raw,
      display: raw,
      unit: 'years',
      raw,
    };
  }

  if (answerType === ANSWER_TYPES.LONG_TEXT) {
    return {
      answer_type: ANSWER_TYPES.LONG_TEXT,
      canonical_value: raw,
      display: raw,
      unit: '',
      raw,
    };
  }

  // Enum values are stored as the normalized option token so that the same
  // answer can be re-matched against a differently worded option list.
  return {
    answer_type: answerType === ANSWER_TYPES.ENUM ? ANSWER_TYPES.ENUM : ANSWER_TYPES.TEXT,
    canonical_value: answerType === ANSWER_TYPES.ENUM ? normalize(raw) : raw,
    display: raw,
    unit: '',
    raw,
  };
}

function refusal(reason, extra = {}) {
  return { ok: false, reason, ...extra };
}

function matchUniqueChoice(options, value, context, aliases) {
  const matches = matchOptions(options, value, context, aliases);
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) return { ambiguous: true };
  return null;
}

function renderChoice(canonical, { options, context, aliases }) {
  const list = options.map(option => (typeof option === 'string' ? { text: option, value: option } : option));
  if (!list.length) return refusal(REFUSAL.CHOICE_NOT_LISTED);

  if (canonical.answer_type === ANSWER_TYPES.LONG_TEXT) {
    return refusal(REFUSAL.ESSAY_NOT_CHOICE);
  }
  // A multi-word sentence offered against short option labels is an answer to a
  // different kind of question, not a choice. Without this it fell through to
  // text matching and came back as `choice-not-listed`, which misreports an
  // essay-vs-radio mismatch as "the option does not exist".
  if (canonical.answer_type !== ANSWER_TYPES.BOOLEAN &&
      words(canonical.display).length >= 10 &&
      list.every(option => words(option.text).length <= 6)) {
    return refusal(REFUSAL.ESSAY_NOT_CHOICE);
  }

  if (canonical.answer_type === ANSWER_TYPES.NUMBER && canonical.unit === 'salary' && canonical.canonical_value?.amount) {
    const { amount, currency, period } = canonical.canonical_value;
    const monthly = period === 'month' ? amount : Math.round(amount / 12);
    for (const probe of [amount, monthly]) {
      const bands = list
        .map(option => ({ option, bounds: salaryBandBounds(option.text, { currency }) }))
        .filter(entry => entry.bounds && salaryBandContains(entry.option.text, probe, { currency }));
      if (bands.length === 1) return { ok: true, option: bands[0].option, text: bands[0].option.text, via: 'salary-band' };
      if (bands.length > 1) {
        // Adjacent ranges share an endpoint in almost every real ATS band list
        // ("30k - 50k" / "50k - 70k" both contain 50,000). Treat the bands as
        // half-open [min, max) so exactly one of them owns the value — and when
        // that still does not settle it, refuse instead of guessing.
        const owner = bands.filter(entry => probe >= entry.bounds.min && probe < entry.bounds.max);
        if (owner.length === 1) return { ok: true, option: owner[0].option, text: owner[0].option.text, via: 'salary-band' };
        return refusal(REFUSAL.AMBIGUOUS_OPTION, { candidates: bands.map(entry => entry.option.text) });
      }
    }
  }

  if (canonical.answer_type === ANSWER_TYPES.NUMBER && canonical.unit === 'duration_days') {
    const band = list.filter(option => {
      const days = readDurationDays(option.text);
      return days !== null && days === canonical.canonical_value;
    });
    if (band.length === 1) return { ok: true, option: band[0], text: band[0].text, via: 'duration-band' };
    if (band.length > 1) return refusal(REFUSAL.AMBIGUOUS_OPTION, { candidates: band.map(b => b.text) });
  }

  const probe = canonical.answer_type === ANSWER_TYPES.BOOLEAN
    ? (canonical.canonical_value ? 'Yes' : 'No')
    : canonical.display;
  const matched = matchUniqueChoice(list, probe, context, aliases);
  if (matched?.ambiguous) {
    const candidates = matchOptions(list, probe, context, aliases).map(match => match.text);
    return refusal(REFUSAL.AMBIGUOUS_OPTION, { candidates });
  }
  if (!matched) return refusal(REFUSAL.CHOICE_NOT_LISTED);
  return { ok: true, option: matched, text: matched.text, via: 'option-match' };
}

function renderText(canonical) {
  if (canonical.answer_type === ANSWER_TYPES.BOOLEAN) {
    return { ok: true, value: canonical.canonical_value ? 'Yes' : 'No', via: 'boolean-text' };
  }
  if (canonical.answer_type === ANSWER_TYPES.NUMBER) {
    const value = canonical.unit === 'salary' && canonical.canonical_value?.amount
      ? String(canonical.canonical_value.amount)
      : String(canonical.canonical_value);
    return { ok: true, value, via: 'number-text' };
  }
  return { ok: true, value: canonical.display, via: 'text' };
}

function renderMulti(canonical, { options, context, aliases }) {
  const list = options.map(option => (typeof option === 'string' ? { text: option, value: option } : option));
  if (!list.length) return refusal(REFUSAL.CHOICE_NOT_LISTED);
  const parts = String(canonical.display || '')
    .split(/[,;|]/)
    .map(part => part.trim())
    .filter(Boolean);
  if (!parts.length) return refusal(REFUSAL.NO_ANSWER);
  const selected = [];
  for (const part of parts) {
    const matched = matchUniqueChoice(list, part, context, aliases);
    if (matched && !matched.ambiguous) selected.push(matched);
  }
  if (!selected.length) return refusal(REFUSAL.CHOICE_NOT_LISTED);
  return { ok: true, options: selected, texts: selected.map(item => item.text), via: 'multi-match' };
}

/**
 * Project a canonical answer into a concrete control.
 *
 * `control` is one of: text | textarea | number | select | radio | radio-group |
 * combobox | checkbox-group | multi. Unknown controls are treated as text.
 *
 * Returns `{ ok: true, ... }` with either `value` (text controls), `option`
 * (choice controls) or `options` (multi controls), or `{ ok: false, reason }`.
 */
export function renderAnswer(answer, {
  control = 'text',
  inputType = '',
  options = [],
  context = '',
  aliases = [],
} = {}) {
  const canonical = typeof answer === 'object' && answer !== null && 'answer_type' in answer
    ? answer
    : canonicalizeAnswer(answer, { inputType: inputType || control, options, context });
  if (!canonical) return refusal(REFUSAL.NO_ANSWER);

  const normalizedControl = String(control || 'text').toLowerCase();
  if (MULTI_CONTROLS.has(normalizedControl)) {
    return renderMulti(canonical, { options, context, aliases });
  }
  if (CHOICE_CONTROLS.has(normalizedControl)) {
    return renderChoice(canonical, { options, context, aliases });
  }
  if (TEXT_CONTROLS.has(normalizedControl) || !normalizedControl) {
    return renderText(canonical);
  }
  // Unknown control: only text-shaped answers are safe, never a choice.
  if (canonical.answer_type === ANSWER_TYPES.LONG_TEXT) return renderText(canonical);
  return refusal(REFUSAL.UNSUPPORTED_CONTROL, { control: normalizedControl });
}
