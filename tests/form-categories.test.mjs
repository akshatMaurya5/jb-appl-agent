import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadCategoryTaxonomy, classifyQuestion, answerPolicy, aliasesFor, getCategory } from '../lib/form-categories.mjs';

const taxonomy = loadCategoryTaxonomy();

// ---------------------------------------------------------------------------
// Taxonomy shape & invariants
// ---------------------------------------------------------------------------
test('ships a valid taxonomy: unique ids, ordered priorities, sensitive gating', () => {
  const seen = new Set();
  let last = -1;
  for (const category of taxonomy.categories) {
    assert.ok(category.id, 'every category has an id');
    assert.ok(!seen.has(category.id), `duplicate id ${category.id}`);
    seen.add(category.id);
    assert.ok(category.priority >= last, `priorities ascend (${category.id})`);
    last = category.priority;
    assert.ok(!(category.sensitive && category.llm_allowed), `${category.id} is sensitive and llm_allowed`);
    assert.ok(Array.isArray(category.option_aliases), `${category.id} has alias groups`);
  }
  assert.ok(getCategory(taxonomy, 'unclassified'), 'unclassified exists');
});

test('sensitive categories never allow the planner; eligibility never does either', () => {
  for (const id of ['terms-consent', 'privacy-consent', 'legal-acknowledgement', 'consent-marketing', 'consent-sms',
    'consent-recording', 'work-authorization', 'visa-sponsorship', 'work-permit', 'citizenship-nationality',
    'demographics-gender', 'demographics-ethnicity', 'demographics-veteran', 'demographics-disability',
    'demographics-communities', 'demographics-orientation', 'misc-sanctioned', 'misc-criminal']) {
    const category = getCategory(taxonomy, id);
    assert.ok(category, `${id} exists`);
    assert.equal(category.llm_allowed, false, `${id} must not reach the planner`);
  }
});

// ---------------------------------------------------------------------------
// Classification over real FAQ corpus stems (normalized, options stripped
// where the inventory layer would strip them; several keep embedded options
// to prove the vetoes survive the noise)
// ---------------------------------------------------------------------------
const realStems = [
  ['are you authorized to work in the country you currently reside in', 'work-authorization'],
  ['are you legally authorized to work in this location', 'work-authorization'],
  // Combined auth+sponsorship question: sponsorship mention vetoes work-authorization.
  ['are you legally authorized to work in this location yes and i will not require sponsorship now or in the future yes but i will require sponsorship now', 'visa-sponsorship'],
  ['do you now or in the future require sponsorship to work in the country you currently reside in', 'visa-sponsorship'],
  ['will you require visa sponsorship to work in this role', 'visa-sponsorship'],
  // "Right to work" is authorization, not a work-permit status: the
  // work-authorization resolver answers it per country from
  // location.authorized_in, while work-permit only echoes location.visa_status.
  ['do you have the right to work in the united kingdom', 'work-authorization'],
  ['are you a citizen of the united states', 'citizenship-nationality'],
  ['what is your nationality', 'citizenship-nationality'],
  ['how many years of relevant post college work experience do you have', 'yoe-numeric'],
  ['how many years of post graduate experience do you have working in backend development', 'yoe-numeric'],
  ['how many years of experience in startups scale ups do you have none less than 2 years 2 to 4 years 4 to 6 years', 'yoe-numeric'],
  ['how many total years of professional experience do you have', 'yoe-numeric'],
  ['which university are you currently attending or did you last attend', 'education-university'],
  ['what is the name of the institution you attended', 'education-university'],
  ['what degree did you earn', 'education-degree'],
  ['what is your highest level of education', 'education-degree'],
  ['what is your education background', 'education-degree'],
  ['what was your major', 'education-major'],
  // "Programming languages" is a skills list, not spoken languages: the
  // languages-primary resolver would answer "English".
  ['what are your primary programming languages', 'skills-technologies'],
  ['what languages do you speak', 'languages-spoken'],
  ['please tell us how you heard about this opportunity', 'referral-source'],
  ['how did you hear about elevenlabs i m a user news article job board social media linkedin instagram x etc in person event referral i was reached out to other please specify', 'referral-source'],
  ['palantir technologies has my consent to contact me about future job opportunities', 'consent-marketing'],
  ['do you agree to allow n8n to contact you about job opportunities', 'consent-marketing'],
  ['i understand the information i submit will be used in accordance to sentry s applicant privacy policy', 'privacy-consent'],
  ['interview recording consent yes i consent to be recorded opt out of recording', 'consent-recording'],
  ['phone check yes or no to indicate your agreement to receive text message updates from ramp business corporation regarding your job application', 'consent-sms'],
  ['i agree to the terms and conditions', 'terms-consent'],
  ['i understand and agree to the terms of the agreement to arbitrate set forth above', 'legal-acknowledgement'],
  ['current employer', 'current-company'],
  ['what is your current company', 'current-company'],
  ['what is your current role', 'current-title'],
  ['github profile', 'links'],
  ['linkedin link', 'links'],
  ['please share your linkedin profile below', 'links'],
  ['please share a link to a paper blog post github repo or something similar that you re proud of', 'links'],
  ['what are your salary expectations', 'salary-expectation'],
  ['what is your expected yearly salary for the role', 'salary-expectation'],
  ['compensation expectations', 'salary-expectation'],
  ['what is your desired salary range', 'salary-expectation'],
  ['notice period availability details', 'notice-period'],
  ['what is your notice period', 'notice-period'],
  // Combined notice+start: notice wins; start-date vetoed.
  ['what is your notice period and or earliest available start date', 'notice-period'],
  ['what is your earliest start date', 'start-date'],
  ['when can you start', 'start-date'],
  ['are you willing to relocate', 'relocation-willingness'],
  ['are you open to work from the office for a significant part of the week once relocated', 'office-attendance'],
  ['which city are you willing to relocate to', 'relocation-willingness'],
  ['what city do you live in', 'location-city'],
  ['which state do you live in', 'location-state'],
  ['what country are you based in', 'location-country'],
  ['where are you located', 'location-autocomplete'],
  ['what is your preferred work location', 'location-autocomplete'],
  ['street address', 'location-address'],
  ['what is your zip code', 'location-postal'],
  ['what is your first name', 'identity-name'],
  ['what is your email address', 'identity-contact'],
  ['pronouns', 'demographics-pronouns'],
  ['name pronunciation', 'demographics-name-pronunciation'],
  ['what is your gender', 'demographics-gender'],
  ['what is your sex', 'demographics-gender'],
  ['sexual orientation', 'demographics-orientation'],
  ['veteran status', 'demographics-veteran'],
  ['do you have a disability', 'demographics-disability'],
  ['which of the following communities do you belong to', 'demographics-communities'],
  ['do you identify as neurodivergent', 'demographics-disability'],
  ['rate your experience with rust no experience beginner i ve read followed tutorials or written small programs', 'skills-self-assessment'],
  ['which best describes your hands on experience with autonomous coding agents or agent orchestration no hands on experience p', 'skills-self-assessment'],
  ['do you have experience working with cloud technologies such as aws or gcp', 'skills-self-assessment'],
  ['have you ever worked directly with javascript engine internals such as v8 isolates deno', 'skills-self-assessment'],
  ['describe your professional experience developing and or working on distributed backend systems', 'essay-background'],
  ['tell us about your experience working in an async and or remote environment', 'essay-background'],
  ['what is your experience designing building or operating scalable systems', 'essay-background'],
  ['why do you want to work here', 'essay-why-us'],
  ['what makes you a great fit for this role', 'essay-why-us'],
  ['what are you most proud of', 'essay-proudest'],
  ['have you informed your manager that you are applying', 'misc-manager-notified'],
  ['are you subject to a non compete agreement', 'misc-non-compete'],
  ['have you worked at this company before', 'misc-previously-employed'],
  ['are you on any sanctioned lists', 'misc-sanctioned'],
  ['have you been convicted of a felony', 'misc-criminal'],
  ['have you ever been convicted of a criminal offence', 'misc-criminal'],
  ['what is the airspeed velocity of an unladen swallow', 'unclassified'],
];

for (const [stem, expected] of realStems) {
  test(`classifies "${stem.slice(0, 60)}" as ${expected}`, () => {
    assert.equal(classifyQuestion(stem, taxonomy).id, expected);
  });
}

test('classification normalizes case and punctuation before matching', () => {
  assert.equal(classifyQuestion('WHAT IS YOUR NOTICE PERIOD?', taxonomy).id, 'notice-period');
  assert.equal(classifyQuestion('  Current   Employer  ', taxonomy).id, 'current-company');
});

test('referral questions with embedded linkedin option text never classify as links', () => {
  const stem = 'how did you hear about us social media linkedin instagram x etc referral job board';
  assert.equal(classifyQuestion(stem, taxonomy).id, 'referral-source');
});

// ---------------------------------------------------------------------------
// Answer policy
// ---------------------------------------------------------------------------
const fakeProfile = {
  candidate: {
    demographics: { pronouns: 'they/them', notice_period: '30 days' },
    current_company: 'Acme',
  },
  application_authorizations: {
    required_submission_terms: { all_companies: true },
    legal_acknowledgements: [{ company: 'Acme', field_label: 'arbitration', approved_option: 'I agree' }],
  },
};

test('answerPolicy resolves profile dot-paths with a provenance source', () => {
  assert.deepEqual(
    answerPolicy(getCategory(taxonomy, 'demographics-pronouns'), fakeProfile),
    { answer: 'they/them', source: 'profile:candidate.demographics.pronouns' },
  );
});

test('answerPolicy returns accept policy when the authorization is true', () => {
  assert.deepEqual(
    answerPolicy(getCategory(taxonomy, 'terms-consent'), fakeProfile),
    { policy: 'accept', source: 'profile:application_authorizations.required_submission_terms.all_companies' },
  );
});

test('answerPolicy passes per-company acknowledgement arrays through for engine matching', () => {
  const result = answerPolicy(getCategory(taxonomy, 'legal-acknowledgement'), fakeProfile);
  assert.equal(result.answer.length, 1);
  assert.equal(result.answer[0].approved_option, 'I agree');
  assert.equal(result.source, 'profile:application_authorizations.legal_acknowledgements');
});

test('answerPolicy returns null without authorization, on missing keys, and for ladder sources', () => {
  assert.equal(answerPolicy(getCategory(taxonomy, 'terms-consent'), { application_authorizations: { required_submission_terms: { all_companies: false } } }), null);
  assert.equal(answerPolicy(getCategory(taxonomy, 'demographics-pronouns'), { candidate: {} }), null);
  assert.equal(answerPolicy(getCategory(taxonomy, 'terms-consent'), undefined), null);
  assert.equal(answerPolicy(getCategory(taxonomy, 'essay-why-us'), fakeProfile), null, 'planner source defers to the ladder');
  assert.equal(answerPolicy(getCategory(taxonomy, 'education-degree'), fakeProfile), null, 'cv source is resolved from cv.md');
  assert.equal(answerPolicy(getCategory(taxonomy, 'consent-marketing'), fakeProfile), null, 'faq source defers to the ladder');
});

// ---------------------------------------------------------------------------
// Aliases & overrides
// ---------------------------------------------------------------------------
test('aliasesFor exposes category-scoped option equivalence groups', () => {
  const groups = aliasesFor(getCategory(taxonomy, 'notice-period'));
  assert.ok(groups.some(group => group.includes('30 days') && group.includes('4 weeks')));
  const cityGroups = aliasesFor(getCategory(taxonomy, 'location-city'));
  assert.ok(cityGroups.some(group => group.includes('bengaluru') && group.includes('bangalore')));
});

test('user overrides from profile.form_categories merge per-category', () => {
  const overridden = loadCategoryTaxonomy({
    profile: { form_categories: [{ id: 'links', question_patterns: ['website url'] }] },
  });
  assert.equal(classifyQuestion('website url', overridden).id, 'links');
  assert.equal(classifyQuestion('what is your notice period', overridden).id, 'notice-period', 'other categories untouched');
});

test('user overrides referencing an unknown category throw', () => {
  assert.throws(
    () => loadCategoryTaxonomy({ profile: { form_categories: [{ id: 'does-not-exist', priority: 1 }] } }),
    /unknown category "does-not-exist"/,
  );
});

test('a user override cannot make a sensitive category planner-eligible', () => {
  assert.throws(
    () => loadCategoryTaxonomy({ profile: { form_categories: [{ id: 'terms-consent', llm_allowed: true }] } }),
    /sensitive category llm_allowed/,
  );
});
