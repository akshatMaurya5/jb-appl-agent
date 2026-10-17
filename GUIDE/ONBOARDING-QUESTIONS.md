# Candidate Onboarding Questionnaire & Profile Blueprint

When setting up `jb-appl-agent` for a new candidate, the AI assistant or user must answer the questions below. These responses populate [`config/profile.yml`](../config/profile.yml), [`modes/_profile.md`](../modes/_profile.md), and [`cv.md`](../cv.md), enabling the autonomous browser runner to answer 100% of standard application questions without hallucination or manual intervention.

---

## 1. Contact & Identity Information
| Question | Target Field in `config/profile.yml` | Form Mapping | Example / Default |
|---|---|---|---|
| What is your full legal name? | `candidate.full_name` | First Name, Last Name | `Akshat Maurya` |
| What is your primary contact email? | `candidate.email` | Email, Confirm Email | `your.email@gmail.com` |
| What is your mobile phone number (with country code)? | `candidate.phone` | Phone, Mobile Number | `+91-7889021799` |
| What is your current city, state, and country of residence? | `candidate.city`, `state`, `country` | Address, City, Country dropdowns | `Bengaluru`, `Karnataka`, `India` |
| What is your postal code / PIN code? | `candidate.postal_code` | Postal Code, PIN, ZIP, Postcode | `560037` |
| What is your LinkedIn profile URL? | `candidate.linkedin` | LinkedIn URL, Profile link | `linkedin.com/in/yourprofile` |
| What is your GitHub profile URL? | `candidate.github` | GitHub URL, Code samples | `github.com/yourhandle` |
| What is your portfolio or website URL? | `candidate.portfolio_url` | Website, Portfolio, Other URL | `https://yourdomain.com` (or empty) |
| Where is your Master Resume PDF located? | `candidate.resume_path` | Resume / CV File Upload | `/Users/.../Resume.pdf` (Absolute path) |

---

## 2. Work Authorization & Sponsorship Policy
| Question | Target Field | Form Mapping | Example / Rule |
|---|---|---|---|
| What country are you a legal citizen of? | `location.country`, `authorized_in` | Citizenship, Work rights | `India` |
| Are you legally authorized to work in your country of residence? | `location.authorized_in` | "Are you authorized to work in [Country]?" | `Yes` |
| Do you require visa sponsorship for international onsite positions? | `location.needs_sponsorship` | "Will you now or in the future require visa sponsorship?" | `Yes` (for onsite Europe/UK/US/etc.); `No` (for domestic India roles) |
| Are you open to worldwide remote roles as a contractor or remote employee? | `location.preferred_locations` | Remote eligibility | `Yes, authorized for remote work from India` |
| What is your relocation preference? | `location.onsite_availability` | "Are you willing to relocate?" | `Open to international relocation with visa sponsorship` |

---

## 3. Professional Experience & Notice Period
| Question | Target Field | Form Mapping | Example / Rule |
|---|---|---|---|
| How many total years of professional software engineering experience do you have? | `demographics.years_of_experience` | "Years of experience", YOE number field | `2.5` (Targeting 1 to 5 years) |
| How should your experience be displayed in text fields? | `demographics.yoe_display` | Text boxes asking for experience | `2.5 years` |
| What is your current employment notice period? | `demographics.notice_period` | Notice period, Earliest availability | `30 days` |
| Have you ever been previously employed by the target company? | `demographics.previously_employed` | "Have you previously worked at [Company]?" | `No` |
| Are you subject to any non-compete agreements? | `demographics.non_compete` | Non-compete covenants | `No` |
| What is your default referral source? | `demographics.referral_source` | "How did you hear about us?" | `Company Career Page` or `LinkedIn` |

---

## 4. Demographic & EEO Survey Data (Voluntary Disclosures)
Standard ATS forms (Greenhouse, Lever, Workday) contain mandatory demographic surveys. The agent fills these automatically according to your explicit choices:

| Survey Question | Target Field | Example Choice | Standard Alternatives |
|---|---|---|---|
| Gender Identity | `demographics.gender` | `Man` / `Male` | `Woman`, `Non-binary`, `Decline to self-identify` |
| Do you identify as Transgender? | `demographics.transgender` | `No` | `Yes`, `Decline to self-identify` |
| Race / Ethnicity | `demographics.ethnicity` | `Asian (Indian)` / `Asian` | `White`, `Black`, `Hispanic/Latino`, `Two or more races`, `Decline` |
| Disability Status | `demographics.disability` | `No, I do not have a disability` | `Yes, I have a disability`, `Decline` |
| Veteran Status | `demographics.veteran_status` | `No, not a protected veteran` | `Yes, protected veteran`, `Decline` |
| Pronouns | `demographics.pronouns` | `he/him/his` | `she/her/hers`, `they/them/theirs` |
| Name Pronunciation | `demographics.name_pronunciation` | `Uhk-shat Mow-ree-yuh` | Phonetic spelling |

---

## 5. Compensation Policy
| Setting | Target Field | Purpose | Example |
|---|---|---|---|
| Numeric Salary (International / USD / EUR) | `salary_form_policy.international_default_numeric` | Default number when a mandatory numeric salary box appears on international forms | `50000` |
| Numeric Salary (Domestic / INR) | `salary_form_policy.india_default_numeric` | Default number on domestic forms | `2500000` |
| Free-Text Salary Expectations | `salary_form_policy.text_default` | Default text when an open string input appears | `Competitive / Market benchmarked` |
| JD Stated Range Strategy | `salary_form_policy.strategy` | If JD mentions a range (e.g. $120k–$150k), what to submit | Submit the lower bound ($120k) to maximize screening pass rate |

---

## 6. Narrative Superpowers & Proof Points (For Written Essays)
These 3 to 5 core bullet points are referenced by OpenRouter when generating grounded answers for open-ended application questions:

1. **High-Throughput Scale**: e.g., *"Engineered transaction and notification systems handling 200M+ transactions/day across multiple data centers."*
2. **Core Tech Stack**: e.g., *"Production mastery of Go, Java, Apache Kafka, Spring Boot, OpenHFT Chronicle Queue, low-latency queues, and Kubernetes."*
3. **Performance & Profiling**: e.g., *"Built custom JVM ByteBuddy bytecode profilers achieving ~10x write throughput and 50% storage footprint reduction."*
4. **Autonomous AI & Remediations**: e.g., *"Engineered self-healing AI agents utilizing MCP tool calling to diagnose and remediate production incidents, cutting debugging time by ~70%."*
5. **Algorithmic Rigor**: e.g., *"Competitive programming background (LeetCode Knight 1980+, Codeforces Specialist) ensuring clean, sound distributed systems design."*

---

## 7. How the AI Agent Onboards a New User

When a new user runs the assistant or asks for setup, the agent executes this sequence:
1. **Interactive Interview**: Prompts the user for the above 7 categories one-by-one (or reviews their existing CV/resume).
2. **Template Synthesis**: Writes the answers into `config/profile.yml`.
3. **CV Synthesis**: Converts the user's career facts into clean Markdown in `cv.md`.
4. **Validation**: Executes `node setup-profile.mjs --validate` to verify all required fields, paths, and formats exist.
