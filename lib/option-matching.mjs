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
  const aliases = {
    yes: ['yes', 'i do', 'i will require', 'i require', 'sponsorship required', 'yes i do', 'true', 'yes i will require sponsorship', 'yes i will need sponsorship in the future', 'yes but i will need sponsorship in the future'],
    no: ['no', 'i do not', 'i will not', 'not required', 'no i do not', 'i have not', 'i have not previously been employed', 'false', 'none', 'never', 'no i need sponsorship now', 'no i will need sponsorship', 'no i need sponsorship'],
    'i am authorized to work in the country due to my nationality': ['i am authorized to work in the country due to my nationality', 'authorized without restriction', 'citizen'],
    'authorized without restriction': ['authorized without restriction', 'i am authorized to work in the country due to my nationality', 'citizen'],
    bengaluru: ['bengaluru', 'bangalore'],
    bangalore: ['bangalore', 'bengaluru'],
    man: ['man', 'male', 'he him', 'he him his'], male: ['male', 'man', 'he him', 'he him his'],
    'he him his': ['he him his', 'he him', 'he/him/his', 'he/him', 'he / him'],
    asian: ['asian', 'asian indian', 'south asian'], indian: ['indian', 'india', 'india +91', '+91'],
    india: ['india', 'india +91', '+91', 'indian'],
    '30 days': ['30 days', '30 day', 'one month', '1 month', '30 days notice period', 'within 30 days', '30 day notice', '30-day notice', '4 weeks', 'four weeks'],
    'company career page': ['company career page', 'career page', 'career site', 'company website', 'company site', 'job board'],
    heterosexual: ['heterosexual', 'heterosexual/straight', 'heterosexual straight', 'straight'],
    'i don t wish to answer': ['i don t wish to answer', 'i don\'t wish to answer', 'prefer not to say', 'i prefer not to say', 'do not wish to answer'],
  };
  const candidates = aliases[wanted] || [];
  const hits = options.filter(option => candidates.some(alias => normalize(option.text) === normalize(alias) || normalize(option.value) === normalize(alias)));
  if (hits.length === 1) return hits;
  if (wanted === 'no') {
    const noHits = options.filter(o => optionPolarity(o.text) === 'no');
    if (noHits.length === 1) return noHits;
  }
  if (wanted === 'yes') {
    const yesHits = options.filter(o => optionPolarity(o.text) === 'yes');
    if (yesHits.length === 1) return yesHits;
  }
  if (wanted === 'company career page') {
    const refHits = options.filter(o => {
      const txt = normalize(o.text);
      return txt.includes('career') || txt.includes('website') || txt.includes('linkedin') || txt.includes('job board');
    });
    if (refHits.length === 1) return refHits;
    const careerHit = options.filter(o => /career/i.test(o.text));
    if (careerHit.length === 1) return careerHit;
    const linkedinHit = options.filter(o => /linkedin/i.test(o.text));
    if (linkedinHit.length === 1) return linkedinHit;
    const otherHit = options.filter(o => /^(?:other|other job boards)$/i.test(o.text.trim()));
    if (otherHit.length === 1) return otherHit;
  }
  return similarityMatchOptions(options, value, context, extraAliases);
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
  if (/\b(?:require|requires|requiring|need|needs|will require|will need|sponsorship required)\b/.test(text)) return 'yes';
  return null;
}

const STOP_WORDS = new Set(['a', 'an', 'and', 'are', 'as', 'at', 'be', 'been', 'being', 'by', 'can', 'could', 'did', 'do', 'does', 'for', 'from', 'had', 'has', 'have', 'how', 'i', 'in', 'into', 'is', 'it', 'of', 'on', 'or', 'please', 'the', 'this', 'to', 'was', 'were', 'what', 'when', 'where', 'which', 'who', 'will', 'with', 'would', 'you', 'your']);
const SYNONYMS = new Map([
  ['man', 'male'], ['male', 'male'], ['woman', 'female'], ['female', 'female'],
  ['heterosexual', 'straight'], ['straight', 'straight'],
  ['sponsor', 'sponsorship'], ['sponsored', 'sponsorship'], ['sponsorship', 'sponsorship'],
  ['acknowledge', 'acknowledgment'], ['acknowledgment', 'acknowledgment'],
  ['recognize', 'acknowledgment'], ['recognise', 'acknowledgment'],
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

export function similarityScore(a, b) {
  const tokensA = similarityTokenize(a);
  const tokensB = similarityTokenize(b);
  if (!tokensA.size || !tokensB.size) return 0;
  const overlap = [...tokensA].filter(token => tokensB.has(token)).length;
  const containment = overlap / Math.min(tokensA.size, tokensB.size);
  const jaccard = overlap / (tokensA.size + tokensB.size - overlap);
  return 0.7 * containment + 0.3 * jaccard;
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
