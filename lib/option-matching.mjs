// Option matching for application-form controls: answer values → visible
// option elements. Extracted from autofill.mjs verbatim (behavior parity).
// Ladder: exact → yes/no → notice period → work pass → visa-from-scratch →
// hispanic → india dial → polarity → relocation → experience ranges →
// city/country → alias table → conservative similarity scoring.
import { normalize } from './autofill-form-utils.mjs';

export { normalize };

export function isUnsafeChoiceContext(context) {
  return /salary|compensation|pay|visa|sponsorship|work authorization|authorized|right to work|citizenship|nationality|country|location|address|phone|email|date of birth|gender|race|ethnicity|hispanic|latino|disability|neurodivergent|veteran|sexual orientation|religion|pronoun|consent|agree|attest|privacy|data transfer|data protection|personal data|gdpr|arbitration|own words|use of ai|generated content|academic performance|high school|degree result|willing|able to|travel|relocat|background check|criminal|notice period|start date|years of experience|company count/i.test(context);
}

export function requiresExplicitDecision(context) {
  return /consent|\bagree\b|\battest\w*|\bcertif\w*|arbitration|waiver|release of claims|background check|criminal|credit check|drug test|terms and conditions|employment agreement|legal agreement|data transfer|data processing|gdpr|truthful|accurate|information.*true/i.test(context);
}

// Legal dropdowns are never inferred. A choice is eligible only when the
// candidate has explicitly approved this exact company, field, and option in
// config/profile.yml. This intentionally does not use fuzzy matching.
export function approvedLegalAcknowledgementOptions(options, context, target, profile) {
  const company = normalize(target?.company || target?.name || '');
  const field = normalize(context);
  if (!company || !field) return [];
  const approved = (profile?.approvedLegalAcknowledgements || []).filter(item => {
    const approvedCompany = normalize(item?.company);
    const approvedField = normalize(item?.field_label);
    return approvedCompany === company && approvedField && field.includes(approvedField);
  });
  const allowedTexts = new Set(approved.map(item => normalize(item.approved_option)).filter(Boolean));
  if (!allowedTexts.size) return [];
  const matches = options.filter(option => allowedTexts.has(normalize(option.text)));
  return matches.length === 1 ? matches : [];
}

export function locationOptionMatches(options, city) {
  const wanted = normalize(city);
  if (!wanted) return [];
  const matches = options.filter(option => {
    const text = normalize(option.text);
    return text === wanted || text.startsWith(`${wanted} `);
  });
  const exact = matches.filter(option => normalize(option.text) === wanted);
  return exact.length ? exact : matches;
}

export function privacyAcknowledgementOptions(options, context) {
  const label = String(context || '');
  if (!/(candidate.{0,40}privacy|privacy\s+(?:notice|policy|statement)|data protection (?:notice|policy|statement)|candidate-privacy-notice|gdpr)/i.test(label)) return [];
  if (/\b(opt[ -]?in|marketing|arbitration|non-compete|criminal|background check)\b/i.test(label)) return [];
  const acknowledgements = options.filter(option => {
    const text = String(option.text || '').trim();
    return /^(?:i\s+)?(?:acknowledge|confirm|agree)(?:\s*\/\s*(?:confirm|acknowledge))?\.?$/i.test(text) ||
      /^i\s+(?:have\s+read(?:\s+and\s+understood)?|understand)\b.*\b(?:privacy\s+(?:notice|policy|statement)|data protection notice|gdpr)\b/i.test(text) ||
      /^(?:acknowledge|confirm|i agree\.?)$/i.test(text);
  });
  return acknowledgements.length === 1 ? acknowledgements : [];
}

export function matchOptions(options, value, context = '', extraAliases = []) {
  const rawWanted = normalize(value);
  const rawExact = options.filter(option => normalize(option.text) === rawWanted || normalize(option.value) === rawWanted);
  if (rawExact.length) return rawExact;
  const wanted = rawWanted.match(/^(yes|no)\b/)?.[1] || rawWanted;
  const question = normalize(context);
  const noticeMatches = noticePeriodOptionMatches(options, value, context);
  if (noticeMatches.length === 1) return noticeMatches;
  if (/\b(?:do|will|would) you\b.{0,70}\b(?:require|need)\s+(?:a\s+)?(?:work pass|work permit|employment pass|work visa)\b/i.test(context) &&
      /require|need/.test(rawWanted)) {
    const yesOptions = options.filter(option => optionPolarity(option.text) === 'yes');
    if (yesOptions.length === 1) return yesOptions;
  }
  if (/work pass|work permit|employment pass|work visa/.test(question) &&
      /require|need/.test(rawWanted)) {
    const workAuthorizationOptions = options.filter(option => {
      const text = normalize(option.text);
      return /\b(?:require|need|sponsor|sponsorship)\b/.test(text) &&
        /\b(?:work pass|work permit|employment pass|work visa|visa sponsorship)\b/.test(text) &&
        !/\b(?:citizen|permanent resident|do not|don t|not required)\b/.test(text);
    });
    if (workAuthorizationOptions.length === 1) return workAuthorizationOptions;
  }
  if (/\b(?:visa|sponsorship)\b/i.test(context) && (wanted === 'yes' || /require|need/.test(rawWanted))) {
    const scratchOption = options.filter(option => /start (?:the )?visa process|from scratch|new visa|initial visa/i.test(option.text));
    if (scratchOption.length === 1) return scratchOption;
  }
  if (/hispanic|latino/.test(question) && (wanted === 'yes' || wanted === 'no')) {
    const originOptions = options.filter(option => {
      const text = normalize(option.text);
      if (wanted === 'yes') return /^(?:yes\b|hispanic\b|latino\b|latina\b|latine\b|i am hispanic\b|i am latino\b|i am latina\b)/.test(text);
      return /^(?:no\b|not hispanic\b|not latino\b|not latina\b|not latine\b|non hispanic\b|non latino\b|non latina\b|i am not hispanic\b|i am not latino\b|i am not latina\b)/.test(text);
    });
    if (originOptions.length === 1) return originOptions;
  }
  if (wanted === 'india') {
    const indiaDial = options.filter(o => /^india(?:\s|$)/i.test(String(o.text || '').trim()) && /\+\s*91\b/.test(String(o.text || '')));
    if (indiaDial.length === 1) return indiaDial;
  }
  const exact = options.filter(o => normalize(o.text) === wanted || normalize(o.value) === wanted);
  if (exact.length) return exact;
  if (wanted === 'yes' || wanted === 'no') {
    const polarityMatches = options.filter(o => optionPolarity(o.text) === wanted);
    if (polarityMatches.length === 1) return polarityMatches;
    const relocationChoices = relocationOptionMatches(options, wanted, context);
    if (relocationChoices.length === 1) return relocationChoices;
  }
  if (/\byears?\b.{0,40}\bexperience\b|\byears? experience\b|\byoe\b/i.test(question)) {
    const years = Number(String(value).match(/\d+(?:\.\d+)?/)?.[0]);
    if (Number.isFinite(years)) {
      const ranged = options.filter(option => experienceOptionContains(option.text, years));
      if (ranged.length === 1) return ranged;
      // Integer-only year lists (0,1,2,3,…): a fractional value (2.5) has no
      // exact option, so round UP to the next listed year rather than letting
      // similarity snap down to "2". "10+" stays a lower-bound option.
      const numeric = options
        .map(option => ({ option, years: Number(normalize(option.text)), raw: String(option.text || '').trim() }))
        .filter(item => Number.isFinite(item.years) && /^\d+(?:\.\d+)?\s*\+?$/.test(item.raw));
      if (numeric.length >= 2) {
        const ceiling = numeric.filter(item => item.years >= years).sort((a, b) => a.years - b.years)[0];
        if (ceiling) return [ceiling.option];
        const plus = numeric.find(item => item.years <= years && /\+$/.test(item.raw));
        if (plus) return [plus.option];
      }
    }
  }
  if (/\b(?:city|country|current location|location city)\b/.test(question)) {
    const geographic = options.filter(option => {
      const text = normalize(option.text);
      return wanted && (text === wanted || text.startsWith(`${wanted} `));
    });
    if (geographic.length === 1) return geographic;
    const exactLead = geographic.filter(option => normalize(option.text).split(' ')[0] === wanted);
    if (exactLead.length === 1) return exactLead;
  }
  // Alias table: every alias is a *synonym of the answer*, never a broader
  // bucket it could plausibly fall into. "Job board" used to be listed as an
  // alias of "Company Career Page", so a form offering [Company career site,
  // Job board] answered "Company Career Page" with **Job board** — a silently
  // wrong application answer. Aliases are also scored, not first-hit: an option
  // that IS the answer must beat an option that merely belongs to its family.
  const candidates = ALIASES[wanted] || [];
  if (candidates.length) {
    const aliasHits = rankAliasCandidates(options, candidates, wanted);
    if (aliasHits) return aliasHits;
  }
  if (wanted === 'no') {
    const noHits = options.filter(o => optionPolarity(o.text) === 'no');
    if (noHits.length === 1) return noHits;
  }
  if (wanted === 'yes') {
    const yesHits = options.filter(o => optionPolarity(o.text) === 'yes');
    if (yesHits.length === 1) return yesHits;
  }
  if (wanted === 'company career page') {
    // Only reached when the answer is the *phrase* "company career page" and no
    // exact alias matched. Most-specific first; a generic source list
    // ("Job board") must never win over a career-site wording.
    const careerHit = options.filter(o => /career/i.test(o.text) && /site|page|website|portal/i.test(o.text));
    if (careerHit.length === 1) return careerHit;
    const websiteHit = options.filter(o => /company (?:website|site|web site)/i.test(o.text));
    if (websiteHit.length === 1) return websiteHit;
    const linkedinHit = options.filter(o => /linkedin/i.test(o.text));
    if (linkedinHit.length === 1) return linkedinHit;
  }
  return similarityMatchOptions(options, value, context, extraAliases);
}

// ---------------------------------------------------------------------------
// Alias table + alias ranking
// ---------------------------------------------------------------------------
// Every entry maps "how the answer is written in the profile/FAQ" to the
// wordings a form actually offers. They are synonyms of ONE answer, so an
// option that *is* the answer must outrank an option that merely shares its
// family (see rankAliasCandidates).
export const ALIASES = Object.freeze({
  yes: ['yes', 'i do', 'i will require', 'i require', 'sponsorship required', 'yes i do', 'true', 'yes i will require sponsorship', 'yes i will need sponsorship in the future', 'yes but i will need sponsorship in the future'],
  no: ['no', 'i do not', 'i will not', 'not required', 'no i do not', 'i have not', 'i have not previously been employed', 'false', 'none', 'never', 'no i need sponsorship now', 'no i will need sponsorship', 'no i need sponsorship'],
  'i am authorized to work in the country due to my nationality': ['i am authorized to work in the country due to my nationality', 'authorized without restriction', 'citizen'],
  'authorized without restriction': ['authorized without restriction', 'i am authorized to work in the country due to my nationality', 'citizen', 'i do not require sponsorship', 'no sponsorship required'],
  bengaluru: ['bengaluru', 'bangalore'],
  bangalore: ['bangalore', 'bengaluru'],
  man: ['man', 'male', 'he him', 'he him his'],
  male: ['male', 'man', 'he him', 'he him his'],
  'he him his': ['he him his', 'he him', 'he/him/his', 'he/him', 'he / him'],
  asian: ['asian', 'asian indian', 'south asian'],
  indian: ['indian', 'india', 'india +91', '+91'],
  india: ['india', 'india +91', '+91', 'indian'],
  '30 days': ['30 days', '30 day', 'one month', '1 month', '30 days notice period', 'within 30 days', '30 day notice', '30-day notice', '4 weeks', 'four weeks'],
  // "Job board" is deliberately NOT here: it is a different referral source,
  // and listing it made "Company Career Page" answer "Job board" on forms that
  // offered both.
  'company career page': ['company career page', 'career page', 'careers page', 'career site', 'careers site', 'company career site', 'company website', 'company site', 'company web site', 'careers website'],
  heterosexual: ['heterosexual', 'heterosexual/straight', 'heterosexual straight', 'straight'],
  'i don t wish to answer': ['i don t wish to answer', 'i don\'t wish to answer', 'prefer not to say', 'i prefer not to say', 'do not wish to answer'],
  'prefer not to say': ['prefer not to say', 'i prefer not to say', 'i don t wish to answer', 'do not wish to answer', 'decline to answer', 'prefer not to disclose'],
});

function aliasSpecificity(optionText, aliasText) {
  const option = normalize(optionText);
  const alias = normalize(aliasText);
  if (!option || !alias) return 0;
  if (option === alias) return 1;
  // The option wording contains the alias as a whole phrase: strong, and more
  // specific than a bare alias hit.
  if (option.includes(` ${alias} `) || option.startsWith(`${alias} `) || option.endsWith(` ${alias}`)) return 0.9;
  // The option is a prefix of the alias (option "Career site" vs alias
  // "Company career site"): acceptable, but never enough to win alone.
  if (alias.includes(` ${option} `) || alias.startsWith(`${option} `) || alias.endsWith(` ${option}`)) return 0.8;
  return 0;
}

/**
 * Rank the options against an answer's alias list.
 *
 * Returns `[option]` only when one option clearly wins: either it is the sole
 * candidate, or it leads the runner-up by at least 0.15. A tie returns `null`
 * so the caller falls through to similarity scoring (which has its own lead
 * requirement) instead of guessing. This is the fix for the "Company Career
 * Page -> Job board" class of silent wrong answer: first-hit is gone.
 */
export function rankAliasCandidates(options, candidates, wanted) {
  const ranked = options
    .map(option => {
      let best = 0;
      for (const alias of candidates) {
        best = Math.max(best, aliasSpecificity(option.text, alias));
      }
      if (best === 0 && wanted) {
        // The answer text itself can appear verbatim inside the option.
        best = aliasSpecificity(option.text, wanted) * 0.9;
      }
      return { option, score: best };
    })
    .filter(item => item.score >= 0.8)
    .sort((a, b) => b.score - a.score);
  if (!ranked.length) return null;
  if (ranked.length > 1 && ranked[0].score - ranked[1].score < 0.15) return null;
  return [ranked[0].option];
}

// ---------------------------------------------------------------------------
// Salary bands
// ---------------------------------------------------------------------------
function parseMoneyToken(raw) {
  const text = String(raw || '').trim().toLowerCase();
  const match = text.match(/(\d[\d,.]*)\s*(k|thousand|lpa|lakh|lac|lacs|m|million)?/);
  if (!match) return null;
  let amount = Number(match[1].replace(/,/g, ''));
  if (!Number.isFinite(amount)) return null;
  const unit = match[2] || '';
  if (unit === 'k' || unit === 'thousand') amount *= 1_000;
  else if (unit === 'lpa' || unit === 'lakh' || unit === 'lac' || unit === 'lacs') amount *= 100_000;
  else if (unit === 'm' || unit === 'million') amount *= 1_000_000;
  return Math.round(amount);
}

/**
 * Bounds of a salary option band, or null when the text carries no money.
 *
 * Returns `{ min, max }` for a range, `{ min, max: Infinity }` for "30k+" /
 * "and above", `{ min: 0, max }` for "below 30k", and `{ min: threshold,
 * max: Infinity }` for a bare "50k" (read as "50k or more").
 *
 * The option-level unit matters: in "3-5 LPA" only the second number carries
 * the unit, so a naive per-token read produced the range 3…500,000 — a band that
 * "contains" every plausible answer, which is what made every Indian banded
 * salary question ambiguous instead of answered.
 */
export function salaryBandBounds(optionText, { currency = '' } = {}) {
  const text = String(optionText || '');
  if (!text.trim()) return null;
  if (currency) {
    const optionCurrency =
      /₹|inr|rs\.?\b/i.test(text) ? 'INR' :
        /\$|usd/i.test(text) ? 'USD' :
          /€|eur/i.test(text) ? 'EUR' :
            /£|gbp/i.test(text) ? 'GBP' : '';
    // Only enforce when the option actually names a currency.
    if (optionCurrency && optionCurrency !== currency) return null;
  }
  const lowered = text.toLowerCase();
  const optionUnit =
    /\b(?:lpa|lakh|lakhs|lac|lacs)\b/.test(lowered) ? 'lpa' :
      /\bk\b|thousand/.test(lowered) ? 'k' :
        /\bmillion\b/.test(lowered) ? 'million' : '';
  const numbers = [...text.matchAll(/(\d[\d,.]*)\s*(k|thousand|lpa|lakh|lakhs|lac|lacs|m|million)?/gi)]
    .map(match => parseMoneyToken(`${match[1]}${match[2] ? ` ${match[2]}` : optionUnit ? ` ${optionUnit}` : ''}`))
    .filter(number => number !== null);
  if (!numbers.length) return null;

  const below = /\b(?:below|under|less than|up to|upto|max|maximum|at most)\b/.test(lowered);
  const above = /\b(?:above|over|more than|plus|and above|and up|\+)\b/.test(lowered);

  if (numbers.length >= 2) {
    return { min: Math.min(...numbers), max: Math.max(...numbers) };
  }
  const threshold = numbers[0];
  if (below) return { min: 0, max: threshold };
  // "30,000+" or a bare "50k" both read as a lower threshold.
  return { min: threshold, max: Infinity, ...(above ? { open: 'above' } : {}) };
}

/**
 * True when a salary option band contains `amount`.
 *
 * Handles "50k - 70k", "$120,000 - $150,000", "5,00,000 - 10,00,000",
 * "Below 30k", "30,000+", "Up to 1.2L", and single-threshold options. Without
 * this, a numeric salary answer ("50000") never matched a band list at all —
 * measured as NO MATCH on a four-band form.
 */
export function salaryBandContains(optionText, amount, options = {}) {
  const value = Number(amount);
  if (!Number.isFinite(value) || value <= 0) return false;
  const bounds = salaryBandBounds(optionText, options);
  if (!bounds) return false;
  // A 2% tolerance so "50k - 70k" accepts 49,000/50,000 alike.
  const tolerance = (Number.isFinite(bounds.max) ? bounds.max : bounds.min) * 0.02;
  return value >= bounds.min - tolerance && value <= bounds.max + tolerance;
}

export function noticePeriodOptionMatches(options, value, context) {
  if (!/notice period|availability|earliest start|start date/i.test(context)) return [];
  const candidate = normalize(value);
  const candidateDays = /\b(?:30 days?|1 month|one month|4 weeks?|four weeks?)\b/.test(candidate) ? 30 : null;
  if (candidateDays == null) return [];
  const days = (amount, unit) => amount * (/month/.test(unit || '') ? 30 : /week/.test(unit || '') ? 7 : 1);
  const matches = options.filter(option => {
    const label = normalize(option.text || option.value);
    if (candidateDays === 30 && /^(?:1 month|one month|30 days?|4 weeks?|four weeks?)$/.test(label)) return true;
    const range = label.match(/(\d+(?:\.\d+)?)\s*(days?|weeks?|months?)?\s*(?:-|to)\s*(\d+(?:\.\d+)?)\s*(days?|weeks?|months?)/);
    if (range) {
      const unit = range[5] || range[2] || 'days';
      return candidateDays >= days(Number(range[1]), range[2] || unit) && candidateDays <= days(Number(range[3]), unit);
    }
    if (/\b(?:up to|at most|or less|or fewer|within)\b/.test(label)) {
      const upper = label.match(/(\d+(?:\.\d+)?)\s*(days?|weeks?|months?)/);
      if (upper) return candidateDays <= days(Number(upper[1]), upper[2]);
      if (/\b(?:one month|a month|1 month)\b/.test(label)) return candidateDays <= 30;
    }
    if (/\b(?:more than|over|above)\b/.test(label)) {
      const lower = label.match(/(\d+(?:\.\d+)?)\s*(days?|weeks?|months?)/);
      if (lower) return candidateDays > days(Number(lower[1]), lower[2]);
    }
    return false;
  });
  return matches;
}

export function relocationOptionMatches(options, wanted, context) {
  if (!/relocat|move to|willing to move/i.test(context)) return [];
  const choices = options.filter(option => {
    const text = String(option.text || '').trim();
    const positiveIntent = /\b(?:plan|intend|willing|open|need|require)\b.{0,30}\brelocat(?:e|ing|ion)\b/i.test(text) ||
      /\b(?:based outside|outside the)\b.{0,30}\brelocation\b/i.test(text) ||
      /\byes\b.{0,30}\brelocat(?:e|ing|ion)\b/i.test(text);
    const negativeIntent = /\b(?:do not|don t|will not|won t|not willing|not open|unable)\b.{0,35}\b(?:plan|intend|want|wish|relocat(?:e|ing|ion))\b/i.test(text) ||
      /\bcurrently (?:live|based|located) in\b/i.test(text);
    if (wanted === 'yes' || (wanted === 'no' && /based in.{0,30}or.{0,30}relocat/i.test(context))) {
      return positiveIntent && !/\bcurrently based in the (?:uk|us|area)\b/i.test(text);
    }
    return negativeIntent;
  });
  return choices;
}

export function experienceOptionContains(label, years) {
  const text = String(label || '').toLowerCase().replace(/,/g, '').trim();
  const range = text.match(/(\d+(?:\.\d+)?)\s*(?:-|–|—|to)\s*(\d+(?:\.\d+)?)/i);
  if (range) return years >= Number(range[1]) && years <= Number(range[2]);
  const lowerBound = text.match(/(\d+(?:\.\d+)?)\s*\+/);
  if (lowerBound) return years >= Number(lowerBound[1]);
  const under = text.match(/(?:under|less than|fewer than)\s*(\d+(?:\.\d+)?)/i);
  if (under) return years < Number(under[1]);
  const atMost = text.match(/(?:up to|at most|or fewer)\s*(\d+(?:\.\d+)?)/i);
  if (atMost) return years <= Number(atMost[1]);
  return false;
}

export function optionPolarity(value) {
  const text = normalize(value);
  // A preference not to answer is neither Yes nor No.
  if (/\b(prefer|decline|wish|rather not|no answer)\b/.test(text)) return null;
  if (/^(?:no|false)\b/.test(text)) return 'no';
  if (/^(?:yes|true)\b/.test(text)) return 'yes';
  if (/\b(?:not|never|without|cannot|can t|don t|doesn t|didn t|won t|will not|do not|does not|did not|not required|not need)\b/.test(text)) return 'no';
  // First-person affirmative forms: "I do", "I am", "I have", "I will", "I can",
  // "I would", "I agree". These are the most common TRUE-branch labels on ATS
  // radio groups ("I do / I do not"), and they are not the word "yes" — so
  // without this branch a stored boolean answer could not match the option that
  // means yes, and every authorization/sponsorship/consent-adjacent question on
  // such a form stayed unresolved while its negative twin resolved fine.
  // The negation branch above runs first, so "I do not" is still 'no'.
  if (/^(?:i|we)\s+(?:do|did|have|has|am|are|will|would|can|could|agree|confirm)\b/.test(text)) return 'yes';
  if (/\b(?:require|requires|requiring|need|needs|will require|will need|sponsorship required)\b/.test(text)) return 'yes';
  return null;
}

const STOP_WORDS = new Set(['a', 'an', 'and', 'about', 'are', 'as', 'at', 'be', 'been', 'being', 'by', 'can', 'could', 'did', 'do', 'does', 'first', 'for', 'from', 'had', 'has', 'have', 'how', 'i', 'in', 'into', 'is', 'it', 'of', 'on', 'or', 'please', 'the', 'this', 'to', 'was', 'were', 'what', 'when', 'where', 'which', 'who', 'will', 'with', 'would', 'you', 'your', 'is there', 'describe', 'briefly']);
// Every entry folds one wording onto a shared token, so two rephrasings of the
// same question overlap even when they share no literal word. Before this map
// had 11 entries, measured scores on real paraphrase pairs were 0.000-0.567 —
// every one below the 0.75 reuse gate, meaning the similarity ladder could only
// ever match near-verbatim repeats.
const SYNONYMS = new Map([
  // identity / demographics
  ['man', 'male'], ['male', 'male'], ['woman', 'female'], ['female', 'female'],
  ['heterosexual', 'straight'], ['straight', 'straight'],
  ['gender', 'gender'], ['sex', 'gender'],
  ['pronouns', 'pronoun'], ['pronouns', 'pronoun'],
  // sponsorship / authorization
  ['sponsor', 'sponsorship'], ['sponsored', 'sponsorship'], ['sponsorship', 'sponsorship'],
  ['visa', 'sponsorship'], ['h1b', 'sponsorship'], ['h1', 'sponsorship'],
  ['authorised', 'authorized'], ['authorized', 'authorized'], ['authorization', 'authorized'],
  ['authorisation', 'authorized'], ['authorize', 'authorized'], ['authorise', 'authorized'],
  ['eligible', 'authorized'], ['eligibility', 'authorized'], ['entitled', 'authorized'],
  ['permitted', 'authorized'], ['legal', 'authorized'], ['lawfully', 'authorized'],
  ['right', 'authorized'],
  ['citizen', 'citizenship'], ['citizenship', 'citizenship'], ['nationality', 'citizenship'],
  ['national', 'citizenship'],
  // compensation
  ['salary', 'compensation'], ['compensation', 'compensation'], ['pay', 'compensation'],
  ['package', 'compensation'], ['ctc', 'compensation'], ['remuneration', 'compensation'],
  ['expectations', 'compensation'], ['expectation', 'compensation'], ['expected', 'compensation'],
  // timing
  ['notice', 'notice'], ['availability', 'notice'], ['available', 'notice'],
  ['start', 'start'], ['commence', 'start'],
  ['immediate', 'immediate'], ['immediately', 'immediate'], ['asap', 'immediate'],
  // experience
  ['experience', 'experience'], ['exp', 'experience'], ['yrs', 'years'], ['year', 'years'],
  ['golang', 'go'],
  // work history / company
  ['current', 'current'], ['presently', 'current'], ['currently', 'current'],
  ['employer', 'employer'], ['company', 'employer'], ['organisation', 'employer'],
  ['organization', 'employer'], ['us', 'employer'], ['our', 'employer'],
  ['worked', 'work'], ['working', 'work'], ['employment', 'work'],
  // provenance / referral
  ['hear', 'source'], ['heard', 'source'], ['learn', 'source'], ['learned', 'source'],
  ['find', 'source'], ['found', 'source'], ['discover', 'source'], ['source', 'source'],
  ['referral', 'referral'], ['referred', 'referral'], ['refer', 'referral'],
  // motivation / essays
  ['excite', 'motivation'], ['excited', 'motivation'], ['excites', 'motivation'],
  ['interest', 'motivation'], ['interested', 'motivation'], ['motivate', 'motivation'],
  ['motivated', 'motivation'], ['appeal', 'motivation'], ['attract', 'motivation'],
  ['why', 'motivation'], ['position', 'role'], ['job', 'role'],
  // location / relocation
  ['relocate', 'relocation'], ['relocating', 'relocation'], ['relocation', 'relocation'],
  ['move', 'relocation'], ['moving', 'relocation'], ['willing', 'willing'], ['willingness', 'willing'],
  ['located', 'location'], ['based', 'location'], ['live', 'location'], ['living', 'location'],
  ['reside', 'location'], ['residence', 'location'], ['residing', 'location'],
  ['city', 'location'], ['country', 'location'], ['address', 'address'],
  // misc
  ['acknowledge', 'acknowledgment'], ['acknowledgment', 'acknowledgment'],
  ['recognize', 'acknowledgment'], ['recognise', 'acknowledgment'],
  ['conviction', 'criminal'], ['convictions', 'criminal'], ['felony', 'criminal'],
  ['previously', 'previous'], ['prior', 'previous'],
]);

// Token-set view used by similarityMatchOptions and by the FAQ similarity
// tiers in lib/application-faq.mjs: stopword removal, synonym folding, and
// yes/no polarity folding (so "Yes" and "No" never share a token).
export function similarityTokenize(text) {
  let normalized = normalize(text);
  normalized = normalized.replace(/\b(?:do not|does not|did not|will not|won t|don t|doesn t|didn t|can t|cannot|never|without)\b/g, ' negation ');
  normalized = normalized.replace(/\b(?:yes|true)\b/g, ' affirmative ');
  normalized = normalized.replace(/\b(?:no|false)\b/g, ' negation ');
  return new Set(normalized.split(/\s+/).filter(token => token && !STOP_WORDS.has(token)).map(token => SYNONYMS.get(token) || token));
}

/** The scoring half of similarityScore, for callers that cache token sets. */
export function similarityScoreTokens(tokensA, tokensB) {
  if (!tokensA?.size || !tokensB?.size) return 0;
  let overlap = 0;
  for (const token of tokensA) if (tokensB.has(token)) overlap++;
  const containment = overlap / Math.min(tokensA.size, tokensB.size);
  const jaccard = overlap / (tokensA.size + tokensB.size - overlap);
  return 0.7 * containment + 0.3 * jaccard;
}

export function similarityScore(a, b) {
  return similarityScoreTokens(similarityTokenize(a), similarityTokenize(b));
}

// Conservative local semantic matching for wording variants. Exact matches,
// known aliases, and polarity rules above take precedence. Fuzzy selection is
// allowed only with a high score and a clear lead over every alternative.
export function similarityMatchOptions(options, value, context, extraAliases = []) {
  if (isUnsafeChoiceContext(context)) return [];
  const expand = text => {
    const tokens = similarityTokenize(text);
    for (const group of extraAliases) {
      const groupWords = group.map(term => similarityTokenize(term));
      // A group fires when one of its terms is fully present (single-word
      // terms) or every word of a multi-word term is present in the text.
      // Firing adds the words of EVERY term in the group, so "Company Career
      // Page" also matches "Company career site" / "Careers website".
      const fires = group.some(words => words.size && [...words].every(word => tokens.has(word)));
      if (fires) groupWords.forEach(words => words.forEach(word => tokens.add(word)));
    }
    return tokens;
  };
  const query = expand(value);
  if (!query.size) return [];
  const ranked = options.map(option => {
    const tokens = expand(option.text || option.value);
    if (!tokens.size) return { option, score: 0 };
    // Opposite polarity is a hard exclusion, even if other words overlap.
    if (query.has('negation') && tokens.has('affirmative')) return { option, score: 0 };
    if (query.has('affirmative') && tokens.has('negation')) return { option, score: 0 };
    const overlap = [...query].filter(token => tokens.has(token)).length;
    const containment = overlap / Math.min(query.size, tokens.size);
    const jaccard = overlap / (query.size + tokens.size - overlap);
    return { option, score: 0.7 * containment + 0.3 * jaccard };
  }).sort((a, b) => b.score - a.score);
  const minimum = query.size === 1 ? 0.84 : 0.76;
  if (!ranked.length || ranked[0].score < minimum) return [];
  if (ranked.length > 1 && ranked[0].score - ranked[1].score < 0.16) return [];
  return [ranked[0].option];
}
