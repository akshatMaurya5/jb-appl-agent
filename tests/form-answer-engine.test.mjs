import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { answerQuestion, explicitApplicationAnswer } from '../lib/form-answer-engine.mjs';
import { findFaqAnswer, findFaqPrecedent, recordApplicationFaq, faqFile } from '../lib/application-faq.mjs';

// Synthetic profile (flat shape from loadCandidateProfile + raw YAML), no PII.
const profile = {
  fullName: 'Jane Doe', firstName: 'Jane', lastName: 'Doe',
  title: 'Backend Engineer', email: 'jane@example.com', phone: '+91-1000000000',
  linkedin: 'linkedin.com/in/jane', github: 'github.com/jane', portfolioUrl: '',
  city: 'Bengaluru', state: 'Karnataka', country: 'India', address: 'Bengaluru, Karnataka, India',
  postalCode: '560001', pronouns: 'they/them', pronunciation: 'jayn', currentCompany: 'Acme Corp',
  languages: ['English'], gender: 'Woman', genderIdentity: 'Female', transgender: 'No',
  disability: 'No', neurodivergent: 'No', ethnicity: 'Asian (Indian)', race: 'Asian', hispanicLatino: '',
  sexualOrientation: 'Heterosexual', veteranStatus: 'No', relocationPreference: 'Onsite in Bengaluru; open to international relocation for roles providing visa sponsorship.',
  yoe: '2.5', noticePeriod: '30 days', previouslyEmployed: 'No', nonCompete: 'No',
  referralSource: 'Company Career Page', sponsorshipRequired: true, authorizedIn: ['India'],
  salaryDefault: '50000', salaryIndiaDefault: '2500000', salaryText: 'Competitive / Market benchmarked',
  explicitFormAnswers: [], approvedLegalAcknowledgements: [],
  authorizeRequiredSubmissionTerms: true,
  raw: {
    application_answers: [
      { company: 'Acme', field_label: 'why do you want to join us', answer: 'Company-specific essay.' },
    ],
    form_answers: {
      age_18_plus: 'Yes', criminal_convictions: 'No', based_in_sanctioned_country: 'No',
      interview_recording_consent: 'Yes, I consent to be recorded', office_attendance: 'Yes',
      sponsorship_type_us: 'Yes, H1B Sponsorship', why_us: 'Generic why-us essay.',
      proudest_project: 'Generic proudest essay.', background: 'Generic background essay.',
    },
    candidate: { education: { university: 'Example University', degree: 'B.Tech', major: 'ECE' } },
  },
};
const target = { company: 'Acme', location: 'San Francisco, US' };
const cv = '## Experience\n### Visa — Bengaluru\n**Software Engineer**\n2022 – Present\n\n## Education\n### Example University -- Jalandhar, India\n**B.Tech, ECE**\n2020 – 2024\n';

test('tier 1: explicit per-company answers win over everything', () => {
  assert.equal(answerQuestion('why do you want to join us', profile, cv, target), 'Company-specific essay.');
  assert.equal(explicitApplicationAnswer('why do you want to join us', target, profile), 'Company-specific essay.');
});

test('tier 2: category-deterministic answers resolve from the profile', () => {
  assert.equal(answerQuestion('what is your notice period', profile, cv, target), '30 days');
  assert.equal(answerQuestion('what is your gender', profile, cv, target), 'Female');
  assert.equal(answerQuestion('are you over 18', profile, cv, target), 'Yes');
  assert.equal(answerQuestion('which university did you attend', profile, cv, target), 'Example University');
  assert.equal(answerQuestion('what is your salary expectation', profile, cv, target), '50000');
  assert.equal(answerQuestion('do you require visa sponsorship to work in the united states', profile, cv, target), 'Yes');
  assert.equal(answerQuestion('do you require visa sponsorship to work in india', profile, cv, target), 'No');
});

test('tier 2: contextual yes/no and computed answers', () => {
  assert.equal(answerQuestion('are you legally authorized to work in india', profile, cv, target), 'Yes');
  assert.equal(answerQuestion('are you legally authorized to work in the united states', profile, cv, target), 'No');
  assert.equal(answerQuestion('do you have at least 5 years of experience', profile, cv, target), 'No');
  assert.equal(answerQuestion('what is your earliest start date', profile, cv, target, {}).match(/^\d{4}-\d{2}-\d{2}$/) !== null, true, 'start date computed from notice period');
});

test('consent and sensitive categories stay deterministic, never empty-guessed', () => {
  assert.equal(answerQuestion('do you consent to be recorded', profile, cv, target), 'Yes, I consent to be recorded');
  assert.equal(answerQuestion('have you been convicted of a felony', profile, cv, target), 'No');
});

test('tier 3: FAQ exact and similarity reuse with sensitive gating', async () => {
  const root = mkdtempSync(join(tmpdir(), 'faq-engine-'));
  try {
    await recordApplicationFaq(root, {
      company: 'Acme', role: 'SWE', date: '2026-10-20',
      questions: [
        { question: 'tell us about your favorite book', answer: 'Dune', answer_source: 'user', options: [] },
        { question: 'what is your expected salary', answer: '99999', answer_source: 'user', options: [] },
      ],
    });
    assert.equal(findFaqAnswer(root, 'tell us about your favorite book'), 'Dune', 'exact tier');
    assert.equal(findFaqAnswer(root, 'what is your favorite book'), 'Dune', 'similarity tier');
    assert.equal(findFaqAnswer(root, 'what is your expected salary'), '', 'sensitive questions never reuse');
    const record = JSON.parse(
      /<!-- career-ops-application-faq-json -->\s*([\s\S]*?)\s*<!-- \/career-ops-application-faq-json -->/
        .exec(readFileSync(faqFile(root), 'utf8'))[1],
    );
    assert.ok(record.questions[0].category, 'recorded questions gain a category');
    assert.equal(record.questions[0].category_source, 'form-categories-v1');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('option precedent surfaces only when the past choice is still on the form', () => {
  const options = [{ text: 'Dune' }, { text: 'Foundation' }];
  const root = mkdtempSync(join(tmpdir(), 'faq-precedent-'));
  try {
    writeFileSync(faqFile(root), `<!-- career-ops-application-faq-json -->\n${JSON.stringify({
      company: 'Acme', role: 'SWE', date: '2026-10-20',
      questions: [{ question: 'tell us about your favorite book', answer: 'Dune', answer_source: 'user', options: ['Dune', 'Foundation'] }],
    })}\n<!-- /career-ops-application-faq-json -->\n`);
    assert.equal(findFaqPrecedent(root, 'what is your favorite book', options), 'Dune');
    assert.equal(findFaqPrecedent(root, 'what is your favorite book', [{ text: 'Foundation' }]), '', 'absent precedent stays quiet');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('unknown questions return empty without a FAQ root (planner tier is the caller’s)', () => {
  assert.equal(answerQuestion('what is the airspeed velocity of an unladen swallow', profile, cv, target), '');
});
