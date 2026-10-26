---
name: find-jobs
description: >-
  Find relevant software engineering jobs matching Akshat's profile across Go, Java, Python, Node.js, TypeScript, and JavaScript.
  Fetches latest postings with exact posting dates, filters out duplicates, and rates EVERY job found out of 5 based on
  match to his profile (score = probability of a shortlist / interview call), with a written rationale per job.
  Defaults to roles outside India; pass "india" to search India-based roles.
arguments: count_or_keywords
user_invocable: true
user-invocable: true
argument-hint: "[number of jobs, e.g. '5' or '10', or custom keywords]"
license: MIT
---

# /find-jobs -- Automated Candidate Job Discovery

This skill finds new, active software engineering opportunities outside India tailored specifically to Akshat Maurya's profile and preferences across Go, Java, Python, Node.js, TypeScript, and JavaScript.

## Operating Principles
1. **Target Archetypes & Expanded Title Synonyms:**
   - **Software Engineer / Developer Family:** Software Engineer (regular, I, II, III, 1, 2, 3), Software Developer, Software Development Engineer (SDE, SDE-2, SDE-3, SDE II, SDE III), SWE (SWE II, SWE III), Member of Technical Staff (MTS, SMTS, MTS 2/3), Application Engineer.
   - **Backend & Server-Side Family:** Backend Engineer (regular, I, II, III, 1, 2, 3), Back-End Engineer, Backend Software Engineer, Backend Developer, Server-Side Engineer, Server Engineer, Backend Systems Engineer, Backend Infrastructure Engineer, Backend Platform Engineer, Software Engineer - Backend, API Engineer, Microservices Engineer.
   - **Java & JVM Roles:** Java Engineer, Java Software Engineer, Java Developer, Java Backend Engineer, Java Systems Engineer, Java Platform Engineer, Java Microservices Engineer, JVM Engineer, Spring Boot Engineer, Core Java Developer.
   - **Go & Golang Roles:** Go Engineer, Go Software Engineer, Go Developer, Go Backend Engineer, Go Systems Engineer, Go Platform Engineer, Golang Engineer, Golang Software Engineer, Golang Developer, Golang Backend Engineer.
   - **Python Roles:** Python Backend Engineer, Python Software Engineer, Python Developer, Python Systems Engineer, Python Platform Engineer, Software Engineer - Python.
   - **Node.js & Node Roles:** Node.js Backend Engineer, Node.js Software Engineer, Node.js Developer, Node Backend Engineer, Node Developer, NodeJS Engineer.
   - **TypeScript & JavaScript Roles:** TypeScript Engineer, TypeScript Developer, TypeScript Backend Engineer, TypeScript Full Stack Engineer, JavaScript Engineer, JavaScript Developer, Full Stack Engineer (Backend-leaning).
   - **Distributed Systems & Systems Software:** Distributed Systems Engineer, Distributed Software Engineer, Distributed Backend Engineer, Distributed Computing Engineer, Systems Software Engineer, Systems Engineer, Systems Developer, Systems Programmer.
   - **Infrastructure, Platform, Cloud & SRE:** Infrastructure Engineer, Platform Engineer, Cloud Engineer, Cloud Infrastructure Engineer, Cloud Platform Engineer, Site Reliability Engineer (SRE), Production Engineer, DevOps Engineer, Data Platform Engineer.
   - **Other Technologies:** C++ Engineer / Systems Engineer, Forward Deployed Software Engineer, AI Systems / Agentic Engineer.
   - Prefer high-concurrency, high-throughput, low-latency, event-driven, and distributed-systems architectures.
   - Supported Tech Stack Suite: Go, Java, Python, Node.js, TypeScript, JavaScript, Spring Boot, Apache Kafka, Microservices, OpenHFT Chronicle Queue, ByteBuddy, low-latency queues, Kubernetes, and cloud infrastructure.
2. **Posting Date Extraction & Freshness Prioritization:**
   - Always extract and display the exact date when the role was posted (`postedAt` ISO date, `posted: YYYY-MM-DD` from pipeline, or `posted_at` / `first_seen` from `data/scan-history.tsv`).
   - Prioritize latest and freshest postings first (roles posted within the last 1–14 days).
   - Display the posting date prominently in the output for every discovered job.
3. **Shortlist Probability Scoring (0 to 5 Scale) — REQUIRED FOR EVERY JOB:**
   - **Every job this skill surfaces must carry a rating out of 5.** The rating answers one question only: *how likely is Akshat to get shortlisted and reach an interview call for this posting?* It is a profile-match score, not a general quality score — a prestigious role he cannot match scores low, and a modest role he matches exactly scores high.
   - Score against his verified background (2.5 YOE, distributed systems, Kafka, high concurrency, Go/Java/Python/Node/TS):
     - **4.5 – 5.0 (Exceptional Fit):** Exact match on core stack (Go or Java backend + Kafka/distributed systems/high concurrency), strictly within 1–4 YOE band, worldwide remote or EU/UK with explicit visa sponsorship & relocation.
     - **4.0 – 4.4 (Strong Fit):** Core backend, platform, or infrastructure role matching Go, Java, Python, Node.js, or TypeScript/JavaScript backend; within 1–5 YOE band; worldwide remote or verified sponsorship.
     - **3.0 – 3.9 (Moderate Fit):** Adjacent stack (Full Stack, TypeScript/JavaScript product engineering, generalist SWE), higher market competition, or soft YOE ceiling (e.g. 4-5 YOE preferred).
     - **2.0 – 2.9 (Low Fit / High Risk):** Skewed towards heavy frontend/mobile, ambiguous sponsorship, or secondary tech stack.
     - **0.0 – 1.9 (Disqualified):** Requires >5 YOE, country-restricted remote without sponsorship, or hard-blocked tech/locations.
   - The score comes from four weighted components, and the **concrete rationale for each one that fired** must travel with it: stack match (core Go/Java/Kafka/distributed > Python/Node/TS > backend-title-only > none), YOE band fit, location/sponsorship signal, and posting freshness.
   - **Never present a job without its `/5` rating and rationale.** In chat, every entry reads like:
     ```
     [1] Acme — Software Engineer, Payments
         Location: Remote (Worldwide) | Posted: 2026-10-22 | Match: 4.6/5.0
         Why: core stack (Go/Java/Kafka/distributed); YOE band 2-4 yrs fits 2.5; worldwide remote; posted within 3 days
     ```
   - The same rating is what `/apply-job all` consumes, so a missing or wrong score is what makes an autonomous apply run work on the wrong jobs first.
4. **Experience Filter (STRICT 1 to 5 Years):**
   - **Target Band:** Only select jobs whose required experience is between **1 and 5 years** (e.g. 1–3 years, 2–4 years, 3–5 years, or mid-level/unspecified software engineer roles fitting 1–5 YOE).
   - **Hard Exclusion:** If any job requires **more than 5 years of experience** (e.g. 6+, 7+, 8+, 10+ YOE, or titles like Staff, Principal, Director, VP, Chief, Head of requiring > 5 YOE), **immediately disqualify and skip it**. It is NOT for Akshat.
   - Also exclude intern, entry-level (< 1 year), or student roles.
5. **Location Policy:**
   - **Default:** Search roles outside India only. Worldwide/global remote postings remain eligible; international onsite roles require explicit visa sponsorship or relocation.
   - **India mode:** `/find-jobs <number> india` searches only roles whose listed location is in India, including India-based onsite, hybrid, and remote roles. Do not include foreign onsite or country-restricted remote roles.
   - Country-bound remote outside India (for example, "Remote, Spain") requires an explicit sponsorship signal; worldwide/global remote does not.
6. **Strict Deduplication:**
   - Check `data/applications.md`, `data/pipeline.md`, and `data/scan-history.tsv`.
   - Never surface a URL or company/role that has already been discovered, evaluated, or applied to.
7. **Liveness & JD Experience Verification (fast path — no browser):**
   - Listings come from the ATS's own public API (`scan.mjs`), so a returned posting is live by construction; do NOT run `check-liveness.mjs` per job.
   - JD text for the shortlist comes from the same ATS API through `fetch-jd.mjs` (Greenhouse/Lever/Ashby/Workday/SmartRecruiters/Zoho). Only postings explicitly requiring >5 YOE, or onsite roles with no sponsorship/relocation signal, are rejected before presentation.
   - Never fall back to a web search or a browser page-load per posting — that is what made the old flow slow.
8. **Autonomous Application Compatibility Guard:**
   - When finding jobs intended for `/apply-job all` autonomous execution, exclude postings whose forms explicitly forbid AI-assisted completion (such as Canonical's mandatory 'answer in your own words / no AI tools' policy accompanied by proprietary high-school score essays) or require original unassisted coding take-homes. Under sequential batch rules, such forms pause required fields for human entry and intentionally stop the batch.

## Search Parameters (edit `portals.yml`, not this skill)

**Role families.** The machine-readable source is `portals.yml → title_filter.positive`, kept in sync with `modes/_profile.md` → "Expanded Title Taxonomy & Synonyms for Discovery":
- **Software Engineer / Developer:** Software Engineer (I/II/III/IV), Software Developer, Software Development Engineer (SDE, SDE I/II/III), SWE, Member of Technical Staff (MTS, SMTS), Application Engineer, Systems Developer.
- **Backend / Server-Side:** Backend Engineer/Developer, Back-End Engineer, Server-Side Engineer, Backend Systems/Infrastructure/Platform, API Engineer, Microservices Engineer.
- **Java / JVM:** Java Engineer/Developer, Java Backend/Systems/Platform/Microservices, JVM Engineer, Java Virtual Machine Engineer, Spring Boot, Core Java.
- **Go / Golang:** Go/Golang Engineer, Developer, Backend, Systems, Platform, Infrastructure.
- **Python:** Python Engineer/Developer, Python Backend/Systems/Platform, Software Engineer - Python.
- **Node.js / Node:** Node.js Engineer/Developer, Node Backend Engineer, NodeJS Developer/Engineer.
- **TypeScript & JavaScript:** TypeScript Engineer/Developer, TypeScript Backend/Full Stack, JavaScript Engineer/Developer.
- **Distributed Systems / Systems Software:** Distributed Systems/Software/Backend/Infrastructure/Computing, Systems Software Engineer, Systems Engineer/Programmer, Infrastructure/Platform Software Engineer.
- **Infrastructure / Platform / Cloud / SRE:** Infrastructure Engineer, Platform Engineer, Cloud Engineer, Site Reliability Engineer (SRE), Production Engineer, DevOps Engineer, Data Platform Engineer.
- **AI Systems / Agentic (secondary archetype):** AI/ML/LLM/Agentic/GenAI Engineer, Forward Deployed Engineer, AI Platform Engineer.
- **Excluded (hard negatives):** Product Manager, Technical PM, Program/Project/Engineering Manager, any `Manager`/`Management` title, Director, VP, Head of, Chief, Solutions/Pre-sales, GTM/RevOps/Business Systems, trainer/teaching roles, intern/junior, Contact Center / Call Center / Support Agent.
- **Levels and seniority variants** (I/II/III/IV, 1/2/3/4, Senior/Sr./Sr, L3–L6, SWE/SDE/SMTS forms) are matched by the base keyword substring — `Software Engineer` covers "Senior Software Engineer II", `SDE` covers "SDE 3", and so on. Staff/Principal/Lead/SMTS are included as IC engineering titles; the 1–5 YOE check rejects the ones that turn out to require more than five years.

**Location policy.** The scan reads every enabled ATS board worldwide; these lists decide what `/find-jobs` ranks and rejects (`portals.yml → find_jobs`):
- **Default mode (outside India):** Worldwide / Global remote, or international onsite in the UK, US, Canada, Germany, Netherlands/Amsterdam, France, Spain, Portugal, Ireland, Poland, Estonia, Lithuania, Sweden, Switzerland, UAE/Dubai, Australia, Singapore, Japan, China, Thailand.
- **Onsite outside India** requires an explicit visa-sponsorship/relocation signal in the location or JD.
- **Country-bound remote** (e.g. "Remote, Spain", "Remote · United States") is not worldwide remote; it needs the same sponsorship signal. "Remote — Global/Worldwide" passes directly.
- **India mode:** only listings whose location identifies India or an Indian city are eligible. A location that is missing or only says worldwide/global remote is not treated as India-based.

**Tunables** (`portals.yml → find_jobs`):

| Key | Default | Meaning |
|-----|---------|---------|
| `count` | 5 | postings staged per run |
| `since_days` | 14 | posting freshness window |
| `shortlist_multiplier` | 3 | JD-check this many × `count`, then keep the best |
| `jd_timeout_ms` | 15000 | per-posting ATS JD timeout |
| `jd_concurrency` | 6 | parallel JD fetches |
| `preferred_locations` | see above | ranking bonus + country-bound remote check |
| `blocked_onsite_locations` | `[]` | optional extra onsite exclusions from profile config |

**Supported `/find-jobs` commands:**

- `/find-jobs` → use the configured default count and search outside India.
- `/find-jobs 10` → `node find-jobs.mjs 10` (outside India).
- `/find-jobs 10 india` → `node find-jobs.mjs 10 india`

No other location tokens are supported. If no count is provided, use `find_jobs.count` from `portals.yml` (default 5).

## Workflow Execution (fast path)

Do NOT run web searches and do NOT open each posting in a browser. One command does discovery, dedup, relevance ranking, and the 1–5 YOE/onsite-sponsorship check:

```bash
node find-jobs.mjs 5 --since 14
```

- **Count:** first positional argument (default `find_jobs.count` in `portals.yml`, 5).
- **Location filter:** outside India is the default. Pass `india` to include only roles located in India.
- **Custom keywords:** `--keywords "kafka,payment,fintech"` boosts matching titles for this run.
- **Wider window:** `--since 30`.
- **No rescan:** `--no-scan` ranks the existing `## Pending` pipeline.

What the command does, in order (zero LLM tokens, no browser):
1. `scan.mjs` fetches every enabled ATS board concurrently through its public API, applies `title_filter` / `location_filter` / `country_eligibility_filter` / `visa_filter` / blacklist, dedups against `data/applications.md`, `data/pipeline.md`, and `data/scan-history.tsv`, then appends new postings to the pipeline and history.
2. Only the postings added by THIS run are ranked: matched `title_filter` keyword specificity, remote/worldwide wording, visa-sponsorship/relocation wording, and any configured keyword bonus. The location mode defaults to outside India; `india` restricts results to India-located roles.
3. The top `count × find_jobs.shortlist_multiplier` are checked against JD text from `fetch-jd.mjs` (ATS API). A posting is rejected when the JD explicitly requires more than 5 years, an onsite role has no sponsorship/relocation signal, or a remote role is restricted to a country the candidate is not in.
4. The accepted top N are written to `data/last-found-jobs.json` as `[{ index, name, company, role, title, url, location, score, shortlist_score, score_rationale, posted_date, yoe, reason }]` — this is exactly the batch `/apply-job all` consumes. `shortlist_score` is the `/5` profile-match rating and `score_rationale` is its written justification; both are always present.
5. It prints a numbered list with location, exact posting date, the `/5` match rating (`Match: 4.6/5.0`), the score rationale, YOE signal, and the match reason.

Then present the printed list — **with each job's `/5` rating and rationale intact, never stripped** — and remind the user: `/apply-job all` for this batch, or `/apply-job <number>` for one.

Typical runtime: ~60–90 seconds for the scan plus ~15 seconds for the shortlist, versus several minutes of web search + per-posting browser loads.
