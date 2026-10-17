#!/usr/bin/env node

/**
 * setup-profile.mjs — Interactive Candidate Onboarding Assistant
 * 
 * Guides a new engineer through setting up their config/profile.yml, cv.md,
 * and environment settings so the autonomous job application agent can run
 * seamlessly for their profile.
 */

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const profilePath = path.join(__dirname, 'config', 'profile.yml');
const cvPath = path.join(__dirname, 'cv.md');
const envPath = path.join(__dirname, '.env');

function askQuestion(query, defaultVal = '') {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise(resolve => {
    const promptText = defaultVal ? `${query} [${defaultVal}]: ` : `${query}: `;
    rl.question(promptText, answer => {
      rl.close();
      resolve(answer.trim() || defaultVal);
    });
  });
}

async function main() {
  console.log('================================================================');
  console.log('  ⚡ Welcome to jb-appl-agent: Software Engineer Onboarding');
  console.log('================================================================');
  console.log('This wizard will configure your profile, contact details,');
  console.log('work authorization, and resume paths for autonomous applications.\n');

  if (fs.existsSync(profilePath)) {
    const overwrite = await askQuestion('config/profile.yml already exists. Overwrite? (y/N)', 'N');
    if (overwrite.toLowerCase() !== 'y') {
      console.log('Existing profile kept. Validating current profile...\n');
      validateProfile();
      return;
    }
  }

  console.log('--- 1. Contact & Identity Information ---');
  const fullName = await askQuestion('Full Legal Name', 'Akshat Maurya');
  const email = await askQuestion('Primary Email', 'your.email@gmail.com');
  const phone = await askQuestion('Phone Number (with country prefix)', '+91-7889021799');
  const city = await askQuestion('Current City', 'Bengaluru');
  const state = await askQuestion('Current State / Province', 'Karnataka');
  const country = await askQuestion('Current Country', 'India');
  const postalCode = await askQuestion('Postal Code / PIN code', '560037');
  const linkedin = await askQuestion('LinkedIn URL', 'https://linkedin.com/in/yourprofile');
  const github = await askQuestion('GitHub URL', 'https://github.com/yourprofile');
  const portfolio = await askQuestion('Portfolio / Website URL (optional)', '');
  const resumePath = await askQuestion('Absolute path to your Master Resume PDF', path.join(process.env.HOME || '', 'Documents', 'Resume.pdf'));

  console.log('\n--- 2. Experience & Role Seniority ---');
  const yoe = await askQuestion('Years of Software Engineering Experience', '2.5');
  const yoeDisplay = await askQuestion('Experience display string', `${yoe} years`);
  const noticePeriod = await askQuestion('Notice Period / Earliest availability', '30 days');

  console.log('\n--- 3. Work Authorization & Sponsorship ---');
  const citizenOf = await askQuestion('Country of Citizenship', country);
  const needsSponsorship = await askQuestion('Require Visa Sponsorship for international onsite roles? (yes/no)', 'yes');
  const openRemote = await askQuestion('Authorized and open to worldwide remote roles? (yes/no)', 'yes');

  console.log('\n--- 4. Demographic & EEO Voluntary Disclosures ---');
  const gender = await askQuestion('Gender Identity', 'Man');
  const transgender = await askQuestion('Identify as Transgender? (No/Yes/Decline)', 'No');
  const ethnicity = await askQuestion('Race / Ethnicity', 'Asian (Indian)');
  const disability = await askQuestion('Disability status (No/Yes/Decline)', 'No');
  const veteranStatus = await askQuestion('Veteran status (No/Yes/Decline)', 'No');
  const pronouns = await askQuestion('Pronouns', 'he/him/his');

  console.log('\n--- 5. Compensation Strategy ---');
  const intlSalary = await askQuestion('Default numerical salary for international forms (USD/EUR)', '50000');
  const domesticSalary = await askQuestion('Default numerical salary for domestic forms (INR)', '2500000');
  const textSalary = await askQuestion('Text salary expectation', 'Competitive / Market benchmarked');

  // Build YAML content
  const yamlContent = `# Career-Ops Profile Configuration
# Generated automatically by setup-profile.mjs

candidate:
  full_name: "${fullName}"
  title: "Backend / Software Engineer"
  email: "${email}"
  phone: "${phone}"
  location: "${city}, ${state}, ${country}"
  city: "${city}"
  state: "${state}"
  country: "${country}"
  address: "${city}, ${state}, ${country}"
  postal_code: "${postalCode}"
  resume_path: "${resumePath}"
  linkedin: "${linkedin}"
  portfolio_url: "${portfolio}"
  github: "${github}"
  photo: ""
  photo_style: rounded
  demographics:
    gender: "${gender}"
    gender_identity: "${gender}"
    transgender: "${transgender}"
    disability: "${disability}"
    neurodivergent: "No"
    ethnicity: "${ethnicity}"
    race: "${ethnicity}"
    sexual_orientation: "Heterosexual"
    veteran_status: "${veteranStatus}"
    pronouns: "${pronouns}"
    years_of_experience: ${parseFloat(yoe) || 2.5}
    yoe_display: "${yoeDisplay}"
    notice_period: "${noticePeriod}"
    earliest_start_date: "${noticePeriod} notice period"
    previously_employed: "No"
    non_compete: "No"
    referral_source: "Company Career Page"
    manager_notified: "Yes"

target_roles:
  experience_range:
    min_years: 1
    max_years: 5
    strict_policy: "Only find and apply to roles requiring 1 to 5 years of experience. Any role requiring > 5 years is strictly excluded."
  primary:
    - "Backend Engineer"
    - "Software Engineer"
    - "Distributed Systems Engineer"
    - "Go Engineer / Golang Developer"
    - "Java Backend Engineer"
    - "Platform / Infrastructure Engineer"
    - "Site Reliability Engineer (SRE)"
    - "Member of Technical Staff (MTS)"
    - "AI Systems / Agentic Engineer"
  archetypes:
    - name: "Backend / Distributed Systems"
      level: "Mid (1-5 YOE)"
      fit: "primary"
    - name: "Platform / Infrastructure Engineer"
      level: "Mid (1-5 YOE)"
      fit: "primary"
    - name: "Agentic AI / Applied AI Engineer"
      level: "Mid (1-5 YOE)"
      fit: "secondary"
    - name: "Full Stack Engineer"
      level: "Mid (1-5 YOE)"
      fit: "adjacent"

compensation:
  target_range: "Open to competitive market compensation"
  currency: "USD / EUR / GBP / INR"
  minimum: "Negotiable based on location, equity, and sponsorship"
  location_flexibility: "Worldwide Remote or International Onsite with Visa Sponsorship"
  salary_form_policy:
    strategy: "If salary range is stated on JD, submit the lower bound; else use defaults below"
    international_default_numeric: ${parseInt(intlSalary, 10) || 50000}
    india_default_numeric: ${parseInt(domesticSalary, 10) || 2500000}
    text_default: "${textSalary}"

location:
  country: "${country}"
  city: "${city}"
  timezone: "IST"
  visa_status: "Citizen of ${citizenOf}. Open to worldwide remote and international onsite roles offering visa sponsorship."
  authorized_in: ["${citizenOf}"]
  needs_sponsorship: ${needsSponsorship.toLowerCase().startsWith('y')}
  onsite_availability: "Open to international relocation for roles providing visa sponsorship."
  preferred_locations:
    - "Worldwide Remote"
    - "${city}, ${country}"
    - "Europe (Netherlands, Germany, Ireland, etc.)"
    - "United Kingdom"
    - "United States"
    - "United Arab Emirates"
    - "Australia"
    - "Singapore"
    - "Japan"

language:
  output: en
`;

  fs.mkdirSync(path.dirname(profilePath), { recursive: true });
  fs.writeFileSync(profilePath, yamlContent, 'utf8');
  console.log(`\n✓ Successfully generated ${profilePath}`);

  // Create cv.md if missing
  if (!fs.existsSync(cvPath)) {
    const cvBoilerplate = `# ${fullName}
${email} · ${phone} · ${city}, ${country} · [LinkedIn](${linkedin}) · [GitHub](${github})

## Professional Summary
Software Engineer with ${yoeDisplay} specializing in backend engineering, distributed systems, event-driven architectures, and high-throughput data pipelines.

## Core Technical Skills
- **Languages:** Go, Java, Python, C++, SQL
- **Frameworks & Runtimes:** Spring Boot, JVM internals, ByteBuddy, OpenHFT Chronicle Queue, gRPC
- **Distributed Systems:** Apache Kafka, Microservices, Event Streaming, Redis, Docker, Kubernetes
- **Databases & Cloud:** PostgreSQL, MySQL, AWS, GCP, CI/CD, Git

## Professional Experience
### Software Engineer
**Tech Company** · Full-time
*2024 – Present | Location*
- Engineered high-throughput backend services and distributed pipelines.
- Optimized system latency, memory footprint, and horizontal scalability.
`;
    fs.writeFileSync(cvPath, cvBoilerplate, 'utf8');
    console.log(`✓ Created template master CV at ${cvPath}`);
  }

  // Create .env if missing
  if (!fs.existsSync(envPath)) {
    const envBoilerplate = `# OpenRouter API Key for open-ended questions & diagnosis
OPENROUTER_API_KEY=your_key_here

# Gmail credentials for Python IMAP OTP reader (optional if using macOS Mail.app)
GMAIL_ADDRESS=${email}
GMAIL_APP_PASSWORD=
`;
    fs.writeFileSync(envPath, envBoilerplate, 'utf8');
    console.log(`✓ Created .env file at ${envPath}`);
  }

  validateProfile();
}

function validateProfile() {
  console.log('--- Validating Configuration ---');
  if (!fs.existsSync(profilePath)) {
    console.error('❌ Missing config/profile.yml');
    return;
  }
  const content = fs.readFileSync(profilePath, 'utf8');
  const hasName = content.includes('full_name:');
  const hasResume = content.includes('resume_path:');
  const hasPostal = content.includes('postal_code:');

  if (hasName && hasResume && hasPostal) {
    console.log('✓ config/profile.yml is well-formed and ready.');
  } else {
    console.warn('⚠ Some expected keys are missing from config/profile.yml. Review GUIDE/ONBOARDING-QUESTIONS.md');
  }

  if (fs.existsSync(cvPath)) {
    console.log('✓ cv.md exists.');
  } else {
    console.warn('⚠ cv.md is missing. Create one to support open-ended question drafting.');
  }

  console.log('\nSetup Complete! You can now run:');
  console.log('  /find-jobs 5               # To find roles matching your profile');
  console.log('  /apply-job all --auto-submit # To apply autonomously');
  console.log('  ./tracker-dashboard.sh     # To view your interactive browser tracker');
}

if (process.argv.includes('--validate')) {
  validateProfile();
} else {
  main().catch(err => {
    console.error('Setup failed:', err.message);
    process.exit(1);
  });
}
