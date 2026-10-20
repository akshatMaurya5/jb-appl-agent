---
name: find-jobs
description: >-
  Find relevant high-concurrency backend, distributed systems, Go, cloud, and infrastructure jobs outside India
  (Worldwide Remote or International Onsite with Visa Sponsorship) matching Akshat's profile.
  Automatically filters out duplicates against data/pipeline.md, data/applications.md,
  and data/scan-history.tsv, records new matches in pipeline.md, and displays a numbered list ready for application.
arguments: count_or_keywords
user_invocable: true
user-invocable: true
argument-hint: "[number of jobs, e.g. '3' or '5', or custom keywords]"
license: MIT
---

# /find-jobs -- Automated Candidate Job Discovery

This skill finds new, active software engineering opportunities outside India tailored specifically to Akshat Maurya's profile and preferences.

## Operating Principles
1. **Target Archetypes & Expanded Title Synonyms:**
   - **Software Engineer / Developer Family:** Software Engineer (regular, I, II, III, 1, 2, 3), Software Developer, Software Development Engineer (SDE, SDE-2, SDE-3, SDE II, SDE III), SWE (SWE II, SWE III), Member of Technical Staff (MTS, SMTS, MTS 2/3), Application Engineer.
   - **Backend & Server-Side Family:** Backend Engineer (regular, I, II, III, 1, 2, 3), Back-End Engineer, Backend Software Engineer, Backend Developer, Server-Side Engineer, Server Engineer, Backend Systems Engineer, Backend Infrastructure Engineer, Backend Platform Engineer, Software Engineer - Backend, API Engineer, Microservices Engineer.
   - **Java & JVM Roles:** Java Engineer, Java Software Engineer, Java Developer, Java Backend Engineer, Java Systems Engineer, Java Platform Engineer, Java Microservices Engineer, JVM Engineer, Spring Boot Engineer, Core Java Developer.
   - **Go & Golang Roles:** Go Engineer, Go Software Engineer, Go Developer, Go Backend Engineer, Go Systems Engineer, Go Platform Engineer, Golang Engineer, Golang Software Engineer, Golang Developer, Golang Backend Engineer.
   - **Distributed Systems & Systems Software:** Distributed Systems Engineer, Distributed Software Engineer, Distributed Backend Engineer, Distributed Computing Engineer, Systems Software Engineer, Systems Engineer, Systems Developer, Systems Programmer.
   - **Infrastructure, Platform, Cloud & SRE:** Infrastructure Engineer, Platform Engineer, Cloud Engineer, Cloud Infrastructure Engineer, Cloud Platform Engineer, Site Reliability Engineer (SRE), Production Engineer, DevOps Engineer, Data Platform Engineer.
   - **Other Technologies:** C++ Engineer / Systems Engineer, Python Backend Engineer, Node.js Backend Engineer, Forward Deployed Software Engineer.
   - Prefer high-concurrency, high-throughput, low-latency, event-driven, and distributed-systems architectures.
   - Core Tech Stack: Go, Java, Spring Boot, Apache Kafka, Microservices, OpenHFT Chronicle Queue, ByteBuddy, low-latency queues, Kubernetes, and cloud infrastructure.
2. **Experience Filter (STRICT 1 to 5 Years):**
   - **Target Band:** Only select jobs whose required experience is between **1 and 5 years** (e.g. 1–3 years, 2–4 years, 3–5 years, or mid-level/unspecified software engineer roles fitting 1–5 YOE).
   - **Hard Exclusion:** If any job requires **more than 5 years of experience** (e.g. 6+, 7+, 8+, 10+ YOE, or titles like Staff, Principal, Director, VP, Chief, Head of requiring > 5 YOE), **immediately disqualify and skip it**. It is NOT for Akshat.
   - Also exclude intern, entry-level (< 1 year), or student roles.
3. **Location Policy:**
   - Outside India:
     - **Option A:** Worldwide Remote (Remote-first companies hiring candidates in India/worldwide).
     - **Option B:** International onsite roles in Europe, the UK, US, UAE, Australia, Singapore, China, Japan, or Thailand only when the posting explicitly offers visa sponsorship/relocation.
   - Exclude India-based onsite/hybrid roles. For worldwide remote jobs, include only postings that explicitly allow candidates based in India or say worldwide/global remote.
4. **Strict Deduplication:**
   - Check `data/applications.md`, `data/pipeline.md`, and `data/scan-history.tsv`.
   - Never surface a URL or company/role that has already been discovered, evaluated, or applied to.
5. **Liveness & JD Experience Verification (fast path — no browser):**
   - Listings come from the ATS's own public API (`scan.mjs`), so a returned posting is live by construction; do NOT run `check-liveness.mjs` per job.
   - JD text for the shortlist comes from the same ATS API through `fetch-jd.mjs` (Greenhouse/Lever/Ashby/Workday/SmartRecruiters/Zoho). Only postings explicitly requiring >5 YOE, or onsite roles with no sponsorship/relocation signal, are rejected before presentation.
   - Never fall back to a web search or a browser page-load per posting — that is what made the old flow slow.
6. **Autonomous Application Compatibility Guard:**
   - When finding jobs intended for `/apply-job all` autonomous execution, exclude postings whose forms explicitly forbid AI-assisted completion (such as Canonical's mandatory 'answer in your own words / no AI tools' policy accompanied by proprietary high-school score essays) or require original unassisted coding take-homes. Under sequential batch rules, such forms pause required fields for human entry and intentionally stop the batch.

## Search Parameters (edit `portals.yml`, not this skill)

**Role families.** The machine-readable source is `portals.yml → title_filter.positive`, kept in sync with `modes/_profile.md` → "Expanded Title Taxonomy & Synonyms for Discovery":
- **Software Engineer / Developer:** Software Engineer (I/II/III/IV), Software Developer, Software Development Engineer (SDE, SDE I/II/III), SWE, Member of Technical Staff (MTS, SMTS), Application Engineer, Systems Developer.
- **Backend / Server-Side:** Backend Engineer/Developer, Back-End Engineer, Server-Side Engineer, Backend Systems/Infrastructure/Platform, API Engineer, Microservices Engineer.
- **Java / JVM:** Java Engineer/Developer, Java Backend/Systems/Platform/Microservices, JVM Engineer, Spring Boot, Core Java.
- **Go / Golang:** Go/Golang Engineer, Developer, Backend, Systems, Platform, Infrastructure.
- **Distributed Systems / Systems Software:** Distributed Systems/Software/Backend/Infrastructure/Computing, Systems Software Engineer, Systems Engineer/Programmer, Infrastructure/Platform Software Engineer.
- **Infrastructure / Platform / Cloud / SRE:** Infrastructure Engineer, Platform Engineer, Cloud Engineer, Site Reliability Engineer (SRE), Production Engineer, DevOps Engineer, Data Platform Engineer.
- **AI Systems / Agentic (secondary archetype):** AI/ML/LLM/Agentic/GenAI Engineer, Forward Deployed Engineer, AI Platform Engineer.
- **Excluded (hard negatives):** Product Manager, Technical PM, Program/Project/Engineering Manager, any `Manager`/`Management` title, Director, VP, Head of, Chief, Staff, Principal, Solutions/Pre-sales, GTM/RevOps/Business Systems, trainer/teaching roles, intern/junior.

**Location policy.** The scan reads every enabled ATS board worldwide; these lists decide what `/find-jobs` ranks and rejects (`portals.yml → find_jobs`):
- **Preferred:** Worldwide / Global remote, or international onsite in the UK, US, Canada, Germany, Netherlands, France, Spain, Portugal, Ireland, Poland, Estonia, Lithuania, Sweden, Switzerland, UAE/Dubai, Australia, Singapore, Japan, China, Thailand.
- **Onsite outside India** requires an explicit visa-sponsorship/relocation signal in the location or JD.
- **Country-bound remote** (e.g. "Remote, Spain", "Remote · United States") is not worldwide remote; it needs the same sponsorship signal. "Remote — Global/Worldwide" passes directly.
- **Blocked onsite:** India-based onsite/hybrid (India, Bengaluru/Bangalore, Hyderabad, Pune, Gurgaon/Gurugram, Noida, Mumbai, Chennai, Delhi). Remote postings that merely list an India office still pass.

**Tunables** (`portals.yml → find_jobs`):

| Key | Default | Meaning |
|-----|---------|---------|
| `count` | 5 | postings staged per run |
| `since_days` | 14 | posting freshness window |
| `shortlist_multiplier` | 3 | JD-check this many × `count`, then keep the best |
| `jd_timeout_ms` | 15000 | per-posting ATS JD timeout |
| `jd_concurrency` | 6 | parallel JD fetches |
| `preferred_locations` | see above | ranking bonus + country-bound remote check |
| `blocked_onsite_locations` | India cities | onsite roles dropped outright |

**Command flags:** `node find-jobs.mjs [count] [--since N] [--keywords "a,b"] [--no-scan] [--dry-run] [--json]`.

## Workflow Execution (fast path)

Do NOT run web searches and do NOT open each posting in a browser. One command does discovery, dedup, relevance ranking, and the 1–5 YOE/onsite-sponsorship check:

```bash
node find-jobs.mjs 5 --since 14
```

- **Count:** first positional argument (default `find_jobs.count` in `portals.yml`, 5).
- **Custom keywords:** `--keywords "kafka,payment,fintech"` boosts matching titles for this run.
- **Wider window:** `--since 30`.
- **No rescan:** `--no-scan` ranks the existing `## Pending` pipeline.

What the command does, in order (zero LLM tokens, no browser):
1. `scan.mjs` fetches every enabled ATS board concurrently through its public API, applies `title_filter` / `location_filter` / `country_eligibility_filter` / `visa_filter` / blacklist, dedups against `data/applications.md`, `data/pipeline.md`, and `data/scan-history.tsv`, then appends new postings to the pipeline and history.
2. Only the postings added by THIS run are ranked: matched `title_filter` keyword specificity, remote/worldwide wording, visa-sponsorship/relocation wording, and any `--keywords` bonus. Onsite-India roles are dropped.
3. The top `count × find_jobs.shortlist_multiplier` are checked against JD text from `fetch-jd.mjs` (ATS API). A posting is rejected when the JD explicitly requires more than 5 years, an onsite role has no sponsorship/relocation signal, or a remote role is restricted to a country the candidate is not in.
4. The accepted top N are written to `data/last-found-jobs.json` as `[{ index, name, company, role, title, url, location, score, yoe, reason }]` — this is exactly the batch `/apply-job all` consumes.
5. It prints a numbered list with location, YOE signal, and the match reason.

Then present the printed list and remind the user: `/apply-job all` for this batch, or `/apply-job <number>` for one.

Typical runtime: ~60–90 seconds for the scan plus ~15 seconds for the shortlist, versus several minutes of web search + per-posting browser loads.
