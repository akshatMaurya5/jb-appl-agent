// form-answer-engine.mjs — the category-driven replacement for autofill.mjs's
// hardcoded ~90-branch answerFor chain.
//
// Ladder (per the approved autonomous-apply plan):
//   1. Explicit per-company application_answers from config/profile.yml.
//   2. Category deterministic: classify the question against
//      templates/form-categories.yml, then resolve the answer from the
//      profile (answerPolicy) or a contextual resolver below. Sensitive and
//      eligibility categories never leave this tier for an LLM.
//   3. FAQ similarity (lib/application-faq.mjs tiers).
// Tier 4 — the native sub-agent — stays with the caller (autofill.mjs's
// planner flow), because dispatch is host-CLI specific (Phase 7).
import { loadCategoryTaxonomy, classifyQuestion, answerPolicy, dotPathGet, aliasesFor, getCategory } from './form-categories.mjs';
import { findFaqAnswer } from './application-faq.mjs';
import { normalize } from './autofill-form-utils.mjs';
import { educationFacts } from './education-facts.mjs';
import { localToday } from './local-today.mjs';

let cachedTaxonomy = null;

export function taxonomyFor(profile = null) {
  if (!cachedTaxonomy) {
    const overrides = profile?.raw?.form_categories ?? profile?.form_categories;
    cachedTaxonomy = loadCategoryTaxonomy({ profile: overrides ? { form_categories: overrides } : undefined });
  }
  return cachedTaxonomy;
}

export function classify(context, profile = null) {
  return classifyQuestion(context, taxonomyFor(profile)).id;
}

// Option aliases of the question's classified category — fed to the option
// matcher so profile answers match wording variants on the live form.
export function optionAliasesFor(context, profile = null) {
  const taxonomy = taxonomyFor(profile);
  const category = classifyQuestion(context, taxonomy);
  if (!category?.id) return [];
  return aliasesFor(getCategory(taxonomy, category.id));
}

// ---------------------------------------------------------------------------
// Tier 1 — explicit per-company answers
// ---------------------------------------------------------------------------
export function explicitApplicationAnswer(context, target, profile) {
  const company = normalize(target?.company || target?.name || '');
  const field = normalize(context);
  const answers = Array.isArray(profile?.raw?.application_answers)
    ? profile.raw.application_answers : (Array.isArray(profile?.explicitFormAnswers) ? profile.explicitFormAnswers : []);
  const matches = answers.filter(item =>
    normalize(item?.company) === company && normalize(item?.field_label) &&
    field.includes(normalize(item.field_label)) && typeof item.answer === 'string'
  );
  return matches.length === 1 ? matches[0].answer : '';
}

// ---------------------------------------------------------------------------
// Helpers carried over from the old answerFor chain
// ---------------------------------------------------------------------------
function rawConfig(profile) { return profile?.raw ?? profile ?? {}; }
function formAnswer(profile, key) { return rawConfig(profile)?.form_answers?.[key] ?? ''; }
function rawDemo(profile, key) { return rawConfig(profile)?.candidate?.demographics?.[key] ?? ''; }

function urlValue(s) { return s ? (/^https?:\/\//i.test(s) ? s : `https://${s}`) : ''; }

function yesNoExplanation(answer, detail, context) {
  if (!/\b(?:yes\s*\/\s*no|yes or no|explain|explanation|briefly explain|in 1|one sentence|2 sentences)\b/i.test(context)) return answer;
  return `${answer}. ${detail}`;
}

function countryHint(text) {
  const t = normalize(text);
  const known = [
    ['India', /\bindia\b/], ['United States', /\b(united states|usa|us)\b/],
    ['United Kingdom', /\b(united kingdom|uk|britain|england|scotland|wales)\b/],
    ['Germany', /\bgermany\b/], ['France', /\bfrance\b/], ['Netherlands', /\b(netherlands|holland)\b/],
    ['Australia', /\baustralia\b/], ['United Arab Emirates', /\b(uae|united arab emirates)\b/],
    ['Switzerland', /\bswitzerland\b/], ['Spain', /\bspain\b/], ['Ireland', /\bireland\b/],
    ['Hong Kong', /\bhong kong\b/], ['Singapore', /\bsingapore\b/], ['China', /\bchina\b/],
    ['Japan', /\bjapan\b/], ['Thailand', /\bthailand\b/], ['New Zealand', /\bnew zealand\b/],
    ['Sweden', /\bsweden\b/], ['Norway', /\bnorway\b/], ['Denmark', /\bdenmark\b/],
    ['Belgium', /\bbelgium\b/], ['Austria', /\baustria\b/], ['Italy', /\bitaly\b/],
    ['Portugal', /\bportugal\b/], ['Poland', /\bpoland\b/], ['Finland', /\bfinland\b/],
    ['Canada', /\bcanada\b/], ['Brazil', /\bbrazil\b/], ['Mexico', /\bmexico\b/],
    ['South Korea', /\b(south korea|republic of korea)\b/], ['Taiwan', /\btaiwan\b/],
    ['Malaysia', /\bmalaysia\b/], ['Indonesia', /\bindonesia\b/], ['Vietnam', /\bvietnam\b/],
    ['Saudi Arabia', /\bsaudi arabia\b/], ['Qatar', /\bqatar\b/], ['Israel', /\bisrael\b/],
    ['Greece', /\bgreece\b/], ['Czechia', /\b(czechia|czech republic)\b/], ['Luxembourg', /\bluxembourg\b/],
    ['Iceland', /\biceland\b/], ['Estonia', /\bestonia\b/], ['Latvia', /\blatvia\b/], ['Lithuania', /\blithuania\b/],
  ];
  return known.find(([, pattern]) => pattern.test(t))?.[0] || '';
}

function extractLocationChoices(context) {
  const raw = String(context || '');
  const match = raw.match(/\b(?:based|located|reside|residing|resident|live|living)\s+in\s+(.+?)(?=\?|[.;]|,|\b(?:and\s+(?:are|would|can|will|able|willing)|(?:are|would|can|will)\s+you)\b|$)/i);
  if (!match) return [];
  return match[1].split(/\s+(?:or|and)\s+|[,/|]/i)
    .map(place => normalize(place.replace(/\b(?:currently|the|a|an|area|metro|greater)\b/gi, ' ')))
    .filter(Boolean);
}

function candidateLocations(profile) {
  return [profile.city, profile.state, profile.country].map(normalize).filter(Boolean);
}

function education(profile, cv) {
  const explicit = rawConfig(profile)?.candidate?.education;
  if (explicit && (explicit.university || explicit.degree || explicit.major)) return explicit;
  return educationFacts(cv);
}

// ---------------------------------------------------------------------------
// Tier 2 — contextual resolvers per category. Each returns an answer string,
// or '' to fall through to the FAQ tier. Simple profile passthroughs are
// handled by answerPolicy; these exist where the answer depends on the
// question's wording or the target posting.
// ---------------------------------------------------------------------------
const RESOLVERS = {
  'work-authorization': ({ context, profile, target }) => {
    const t = normalize(context);
    if (/(authorized|eligible) to work in this location|legally (authorized|authorised)/.test(t) && !countryHint(context)) {
      // "This location" without a named country: defer to the posting.
      const country = countryHint(target.location);
      if (country && profile.authorizedIn.some(item => normalize(item) === normalize(country))) {
        return 'Yes, and I will not require sponsorship now or in the future';
      }
      return profile.sponsorshipRequired ? 'Yes, but I will require sponsorship now or in the future' : '';
    }
    const country = countryHint(context) || countryHint(target.location);
    if (country) {
      const authorized = profile.authorizedIn.some(item => normalize(item) === normalize(country));
      return yesNoExplanation(authorized ? 'Yes' : 'No',
        authorized ? `I am authorized to work in ${country}.` : `I am currently authorized to work in ${profile.authorizedIn.join(', ')}, not ${country}.`, context);
    }
    return profile.sponsorshipRequired ? 'No' : 'Yes';
  },

  'visa-sponsorship': ({ context, profile, target }) => {
    const t = normalize(context);
    if (/select the type of sponsorship|h1b/.test(t)) return formAnswer(profile, 'sponsorship_type_us');
    if (/without/.test(t)) return profile.sponsorshipRequired ? 'No' : 'Yes';
    const country = countryHint(context) || countryHint(target.location);
    const answer = country === 'India' ? 'No' : profile.sponsorshipRequired ? 'Yes' : 'No';
    const place = country || 'the job location';
    return yesNoExplanation(answer,
      answer === 'Yes' ? `I would require visa sponsorship to work in ${place}.` : `I would not require visa sponsorship to work in ${place}.`, context);
  },

  'work-permit': ({ context, profile, target }) => {
    const country = countryHint(context) || countryHint(target.location);
    if (country && normalize(country) === normalize(profile.country)) return 'I do not require a work pass';
    if (profile.country === 'India' && country && !profile.authorizedIn.some(item => normalize(item) === normalize(country))) {
      return 'I require a work pass';
    }
    return '';
  },

  'citizenship-nationality': ({ context, profile }) => {
    const t = normalize(context);
    // Only an actual yes/no EU-citizen question takes the EU answer. "If you
    // are not an EU citizen, what is your citizenship?" mentions EU as
    // conditional context and asks for a country instead.
    if (/are you an?\s+eu\s+(citizen|national)\b|do you hold\s+eu/.test(t)) return formAnswer(profile, 'eu_citizen');
    if (/(additional|dual)/.test(t)) return formAnswer(profile, 'additional_citizenship');
    if (/(what|which)\b.{0,60}\b(citizenship|nationality)\b/.test(t)) {
      return profile.country === 'India' ? 'India' : profile.country;
    }
    // "Country of citizenship" asks for a country; bare nationality lists use the demonym.
    return /\bcountry\b/.test(t) ? profile.country : profile.country === 'India' ? 'Indian' : profile.country;
  },

  'relocation-willingness': ({ context, profile }) => {
    const t = normalize(context);
    const preference = normalize(profile.relocationPreference);
    // "What is your current country of residence?" asks for a country, not a
    // yes/no willingness answer.
    if (/(?:what (?:is )?your (?:current )?country|country of residence|what country do you (?:live|reside)|current (?:country|location) of residence)/.test(t)) {
      return profile.country;
    }
    if (/remain in (your )?current location/.test(t)) {
      const currentCountry = normalize(profile.country);
      const authorized = profile.authorizedIn.some(item => normalize(item) === currentCountry);
      if (authorized) return 'No';
      return profile.sponsorshipRequired ? 'Yes' : '';
    }
    const places = extractLocationChoices(context);
    if (places.length) {
      const candidates = candidateLocations(profile);
      return places.some(place => candidates.includes(place)) ? 'Yes' : 'No';
    }
    if (/(not open|unable|cannot|can t|do not|don t|no relocation)/.test(preference)) return 'No';
    if (/(open to|willing to|able to|relocation)/.test(preference)) return 'Yes';
    return '';
  },

  'office-attendance': ({ profile }) => {
    const explicit = formAnswer(profile, 'office_attendance');
    if (explicit) return explicit;
    const preference = normalize(profile.relocationPreference);
    if (/remote only|fully remote/.test(preference)) return 'No';
    return '';
  },

  'location-city': ({ context, profile }) => {
    const t = normalize(context);
    if (/(are you|do you)/.test(t) && /(based|reside|live|living) in/.test(t)) {
      const places = extractLocationChoices(context);
      if (places.length) {
        const candidates = candidateLocations(profile);
        return places.some(place => candidates.includes(place)) ? 'Yes' : 'No';
      }
    }
    return profile.city;
  },

  'location-state': ({ context, profile }) => {
    if (/following states|one of the following states/.test(normalize(context))) {
      return formAnswer(profile, 'us_states_resident');
    }
    return profile.state;
  },

  'location-autocomplete': ({ context, profile, target }) => {
    const t = normalize(context);
    if (/intend to work from/.test(t)) return formAnswer(profile, 'work_from_location');
    if (/work contract/.test(t)) return formAnswer(profile, 'work_contract_location');
    if (/available to work in what cities|preferred work location/.test(t)) {
      const targetCity = String(target.location || '').split(/[,(]/)[0]?.trim();
      return targetCity || profile.city;
    }
    return profile.city && profile.country ? `${profile.city}, ${profile.country}` : profile.city;
  },

  'identity-name': ({ context, profile }) => {
    const t = normalize(context);
    if (/preferred/.test(t)) return profile.firstName;
    if (/last name|family name|surname/.test(t) && !/(first|full|legal)/.test(t)) return profile.lastName;
    if (/first name|given name/.test(t) && !/(last|full|legal)/.test(t)) return profile.firstName;
    return profile.fullName;
  },

  'identity-contact': ({ context, profile }) => {
    const t = normalize(context);
    // A phone-country/dial selector shares its wrapper with the phone input:
    // it asks for the country, not the number.
    if (/\b(?:phone|mobile|telephone)\b/.test(t) && /\b(?:country|dial)\b/.test(t)) return profile.country;
    return /(phone|mobile|telephone)/.test(t) ? profile.phone : profile.email;
  },

  'links': ({ context, profile }) => {
    const t = normalize(context);
    if (/linkedin/.test(t)) return urlValue(profile.linkedin);
    if (/github/.test(t)) return urlValue(profile.github);
    return urlValue(profile.portfolioUrl) || urlValue(profile.github);
  },

  'current-company': ({ profile, cv }) => {
    if (profile.currentCompany) return profile.currentCompany;
    const roles = [...String(cv || '').matchAll(/^###\s+([^\n]+)\n([\s\S]*?)(?=^###\s+|^##\s+|$)/gm)];
    const currentRole = roles.find(([, , details]) => /\bPresent\b/i.test(details));
    return currentRole?.[1]?.split(/\s+[-–—]\s+/)[0]?.trim() || '';
  },

  'current-title': ({ profile }) => profile.title || 'Software Engineer',

  'yoe-numeric': ({ context, profile }) => {
    const t = normalize(context);
    const minimumYears = String(context).match(/\b(?:at least|minimum of|minimum)\s+(\d+(?:\.\d+)?)\s*(?:\+\s*)?years?\b/i);
    if (minimumYears) {
      const years = Number(profile.yoe);
      if (Number.isFinite(years)) {
        const answer = years >= Number(minimumYears[1]) ? 'Yes' : 'No';
        return yesNoExplanation(answer, `I have ${profile.yoe} years of professional experience as listed in my profile.`, context);
      }
    }
    if (/how long have you been working remotely/.test(t)) return formAnswer(profile, 'remote_work_duration');
    if (/startup|scale up/.test(t)) return formAnswer(profile, 'startup_experience');
    if (/platform engineering|developer experience|ci cd|infrastructure/.test(t)) return formAnswer(profile, 'platform_experience_years');
    // Tech-specific YOE questions go to the FAQ tier / planner, not the flat number.
    if (/\b(?:go|golang|rust|python|java|aws|gcp|azure|kubernetes|docker|postgresql|sql|kafka) experience\b/i.test(context) &&
        /\byears? (?:of )?(?:professional )?(?:experience )?(?:with|in|using)\b/i.test(context)) return '';
    return profile.yoe;
  },

  'notice-period': ({ profile }) => profile.noticePeriod || dotPathGet(profile.raw, 'candidate.demographics.notice_period') || '',

  'start-date': ({ context, profile }) => {
    if (/ideal start date|earliest start date/.test(normalize(context))) {
      const noticeDays = String(profile.noticePeriod || '').match(/\d+/)?.[0];
      if (noticeDays) {
        const date = new Date(`${localToday()}T12:00:00`);
        date.setDate(date.getDate() + Number(noticeDays));
        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
      }
      return '';
    }
    return profile.noticePeriod;
  },

  'salary-expectation': ({ profile }) => profile.jobSalary || profile.salaryDefault || profile.salaryText,

  'education-university': ({ profile, cv }) => education(profile, cv).university || '',
  'education-degree': ({ profile, cv }) => education(profile, cv).degree || '',
  'education-major': ({ profile, cv }) => education(profile, cv).major || '',

  'languages-primary': ({ profile }) => formAnswer(profile, 'primary_programming_languages') || (profile.languages || []).join(', '),
  'languages-spoken': ({ profile }) => (profile.languages || []).join(', '),

  'demographics-gender': ({ context, profile }) => {
    const t = normalize(context);
    if (/transgender/.test(t)) return profile.transgender;
    if (/gender identity/.test(t)) return profile.gender;
    return profile.genderIdentity || profile.gender;
  },

  'demographics-ethnicity': ({ context, profile }) => {
    const t = normalize(context);
    if (/hispanic|latino/.test(t)) {
      const explicit = normalize(profile.hispanicLatino);
      if (explicit) return /^(yes|true|hispanic|latino|latina|latine)$/.test(explicit) ? 'Yes' :
        /^(no|false|not hispanic|not latino|not latina|not latine)$/.test(explicit) ? 'No' : '';
      const background = normalize(`${profile.ethnicity} ${profile.race}`);
      if (/\b(hispanic|latino|latina|latine)\b/.test(background)) return 'Yes';
      if (/\b(asian|indian|south asian|east asian|southeast asian)\b/.test(background) &&
          !/\b(hispanic|latino|latina|latine)\b/.test(background)) return 'No';
      return '';
    }
    return profile.race || profile.ethnicity;
  },

  'demographics-disability': ({ context, profile }) =>
    /neurodivergent|neurodiverse/.test(normalize(context)) ? profile.neurodivergent : profile.disability,

  'demographics-communities': ({ context, profile }) => {
    if (/household earner/.test(normalize(context))) return formAnswer(profile, 'household_earner');
    return '';
  },

  'demographics-veteran': ({ profile }) => profile.veteranStatus,
  'demographics-orientation': ({ profile }) => profile.sexualOrientation,
  'demographics-pronouns': ({ profile }) => profile.pronouns,
  'demographics-name-pronunciation': ({ profile }) => profile.pronunciation,

  'referral-source': ({ profile }) => profile.referralSource || 'Company Career Page',

  'misc-manager-notified': ({ profile }) => rawDemo(profile, 'manager_notified'),
  'misc-non-compete': ({ profile }) => profile.nonCompete,
  'misc-previously-employed': ({ profile }) => profile.previouslyEmployed,
  'misc-age-18': ({ profile }) => formAnswer(profile, 'age_18_plus'),

  'misc-sanctioned': ({ context, profile }) => {
    const t = normalize(context);
    if (/iran|cuba|north korea|syria/.test(t)) return formAnswer(profile, 'based_in_sanctioned_country');
    if (/currently based in any of these countries|countries where we are accepting applications/.test(t)) return profile.country;
    return formAnswer(profile, 'based_in_sanctioned_country');
  },

  'misc-criminal': ({ profile }) => formAnswer(profile, 'criminal_convictions'),

  'legal-acknowledgement': ({ context, profile }) => {
    if (/certify|true and correct|best of my knowledge|processed in accordance/.test(normalize(context))) {
      return formAnswer(profile, 'certification_attestation');
    }
    return ''; // Per-company approved options are handled by the fill layer.
  },

  'consent-recording': ({ profile }) => formAnswer(profile, 'interview_recording_consent'),

  'essay-background': ({ context, profile }) => {
    const t = normalize(context);
    if (/resumes only tell part of the story|choose one to share/.test(t)) return formAnswer(profile, 'choose_one_story');
    if (/distributed or real-time streaming|designing building or operating distributed/.test(t)) return formAnswer(profile, 'distributed_systems_experience');
    if (/tell (us|me) about yourself|professional summary|describe your background/.test(t)) return formAnswer(profile, 'background');
    return '';
  },

  'essay-why-us': ({ profile }) => formAnswer(profile, 'why_us'),
  'essay-proudest': ({ profile }) => formAnswer(profile, 'proudest_project'),

  'skills-self-assessment': ({ context, profile }) => {
    const t = normalize(context);
    if (/n8n/.test(t)) return formAnswer(profile, 'n8n_experience');
    if (/ai assisted|autonomous software development/.test(t)) return formAnswer(profile, 'ai_workflows_experience');
    if (/autonomous coding agents|agent orchestration/.test(t)) return formAnswer(profile, 'autonomous_agents_experience');
    if (/personally designed or implemented/.test(t)) return formAnswer(profile, 'designed_implemented');
    if (/measurement evaluation/.test(t)) return formAnswer(profile, 'measurement_evaluation');
    if (/experience with go|golang experience/.test(t)) return formAnswer(profile, 'go_experience');
    return '';
  },
};

function deterministicAnswer(category, context, profile, cv, target) {
  const resolver = RESOLVERS[category.id];
  if (resolver) {
    const answer = resolver({ category, context, profile, cv, target });
    if (answer !== null && answer !== undefined && answer !== '') return answer;
  }
  const policy = answerPolicy(category, rawConfig(profile));
  if (policy?.answer !== undefined && policy.answer !== null && typeof policy.answer !== 'object') {
    return policy.answer;
  }
  return '';
}

// ---------------------------------------------------------------------------
// The ladder
// ---------------------------------------------------------------------------
export function answerQuestion(context, profile, cv = '', target = {}, { faqRoot } = {}) {
  const explicit = explicitApplicationAnswer(context, target, profile);
  if (explicit) return explicit;

  const taxonomy = taxonomyFor(profile);
  const category = classifyQuestion(context, taxonomy);
  const answer = deterministicAnswer(category, context, profile, cv, target);
  if (answer) return answer;

  if (faqRoot) {
    const faq = findFaqAnswer(faqRoot, context, { category: category.id });
    if (faq) return faq;
  }
  return '';
}
