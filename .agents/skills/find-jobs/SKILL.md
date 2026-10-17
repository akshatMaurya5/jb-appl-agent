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
5. **Liveness & JD Experience Verification:**
   - Verify that the ATS job link is live and accepts applications (via `check-liveness.mjs` or direct API check).
   - Inspect the JD text to verify required experience is strictly within the 1–5 years range before presenting.

## Workflow Execution
1. Read existing URLs from `data/applications.md`, `data/pipeline.md`, and `data/scan-history.tsv`.
2. Discover fresh postings via ATS APIs (Greenhouse, Ashby, Lever) or web search matching target keywords and location criteria.
3. Filter out any already-tracked URLs.
4. Write newly discovered jobs to:
   - `data/last-found-jobs.json` as `[{ "index": 1, "name": "Company", "role": "Role", "url": "URL", "location": "Location" }, ...]`.
     *(This guarantees that a subsequent `/apply-job all` or `/apply-job <number>` applies strictly to this new batch).*
   - `data/pipeline.md` under `## Pending` as `- [ ] {url} — {Company} ({Role}, {Location})`
   - `data/scan-history.tsv` to ensure persistent deduplication across runs.
5. Present the results to the user as a clean numbered list:
   - **[1] Company — Role Title**
     - **Location & Visa/Remote:** e.g., Paris, France (Full Visa Sponsorship & Relocation)
     - **Tech Stack & Alignment:** Specific match with candidate's background
     - **Application Link:** Direct ATS application URL
6. Remind the user that they can apply to all of these newly found jobs by saying `/apply-job all`, or apply to a single one via `/apply-job <number>`.
