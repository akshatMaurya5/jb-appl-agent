# RE_ARCHITECTURE: Autonomous End-to-End Apply Pipeline

This document describes the re-architecture of career-ops's job-application
pipeline (branch `feat/autonomous-apply-rework`, PR #5) into a **fully
autonomous end-to-end form submission agent**: a background process finds jobs
and applies with zero human intervention — fill every field, handle email OTP
verification, prove 100% mandatory coverage, submit, move to the next job.

## 1. Why: problems with the old pipeline

`autofill.mjs` (~2,470 lines) had:

1. **A ~90-branch hardcoded if-else answer chain** (`answerFor`) with hardcoded
   candidate facts and company-specific essays. New questions meant new code.
2. **Exact-string-only FAQ reuse** (`lib/application-faq.mjs`): a previously
   answered question was reusable only if the new wording matched verbatim.
3. **No post-fill verification** that every mandatory field actually landed.
4. **OTP attempted exactly once** — one missed email and the submission died.
5. **A stuck form blocked the whole queue** for 5 minutes and was never killed
   (`autofill.mjs` left the tab open and `break`ed, hanging the run).
6. **The OpenRouter LLM tier** was part of form planning, mixing an external
   paid API into what should be a local, deterministic pipeline.

## 2. Architecture overview

`autofill.mjs` remains the driver (2,470 → ~1,950 lines) owning its Playwright
browser, but the hardcoded chain is replaced by a **category engine** driven by
a system-layer taxonomy whose answer *values* come only from user-layer files
(`config/profile.yml`, `cv.md`, `FAQS.md`). Data Contract holds: the taxonomy
stores structure/matchers/aliases only — **no candidate values**.

```
                        ┌────────────────────────────────────────────┐
                        │             apply-runner.mjs               │
                        │  background loop (--loop/--interval N)     │
                        │  targets: data/last-found-jobs.json +      │
                        │           data/pipeline.md Pending         │
                        └──────────────┬─────────────────────────────┘
                                       │ spawn per job (SIGKILL deadline)
                                       ▼
                        ┌────────────────────────────────────────────┐
                        │              autofill.mjs                  │
                        │  preflight (headless inventory+plan)       │
                        │  visible Chromium, watchdog raceWithDeadline│
                        └───┬───────────────┬───────────────┬────────┘
                            │               │               │
              fillSemanticFields       form-verify      otp-flow
              (planVisibleForm)     mandatoryCoverage  runOtpFlow
                            │               │               │
                    ┌───────┴───────┐       │               │
                    ▼               ▼       ▼               ▼
        lib/form-answer-engine   lib/option-matching  lib/otp-entry
        (4-tier answer ladder)   (matcher + similarity)
                    │
        ┌───────────┼───────────────┐
        ▼           ▼               ▼
  form-categories  application-faq  planner-dispatch
  (taxonomy, 53    (Tier 0/1/2     (native sub-agent
   categories)      similarity)     only, no OpenRouter)
```

The per-job flow:

1. **Preflight** (headless): inventory the form, plan answers for every visible
   control, attach the resume.
2. **Visible browser**: fill all controls, then the **verify loop** (§5).
3. **Submit gate**: the final submit click happens only at 100% mandatory
   coverage, in interactive mode after the candidate clicks, in autonomous mode
   directly (explicit user authorization).
4. **OTP** (when the ATS asks): poll the email, enter the code, retry with a
   fresh code, resubmit after verification (§8).
5. **Confirmation**: success is ATS confirmation only — never email arrival.
6. **Watchdog**: any phase over budget → record to `data/apply-failures.tsv`,
   kill the tab, advance to the next job (§7).

## 3. How a NEW question gets answered (the answer ladder)

Every question — seen or never seen — goes through the same 4-tier ladder in
`lib/form-answer-engine.mjs` (`answerQuestion`) and `autofill.mjs`
(`planVisibleForm`):

**Tier 1 — explicit per-company answers.** `application_answers` in
`config/profile.yml`: exact company + field-label match, top priority. This is
where per-company legal/eligibility answers (e.g. Cloudflare's sponsorship
question) live.

**Tier 2 — category deterministic.** `classifyQuestion` matches the question
against **53 categories** in `templates/form-categories.yml` (priority-ordered
regex `question_patterns` with `excludes` vetoes). Answers resolve from the
profile via `answerPolicy` (`source: profile, key: ...`) or a contextual
resolver in `form-answer-engine.mjs`. Categories carrying `llm_allowed: false`
(sensitive, legal, eligibility — visa, work authorization, citizenship,
demographics, salary, notice period, consent) are **terminal**: they are
answered here or left blank; they NEVER reach an LLM.

**Tier 3 — FAQ similarity (the matcher).** See §4. Deterministic, zero LLM
cost.

**Tier 4 — native sub-agent.** Only leftover **non-sensitive** questions reach
the planner (`lib/planner-dispatch.mjs`): it hands the full form inventory, the
unanswered questions, the trusted profile/CV, and the FAQ history (explicitly
flagged as lower-trust precedent) to a **native** sub-agent. Every answer is
accepted only with `supported: true`; every option choice only at
`confidence ≥ 0.8` AND only if the option actually exists on the current form.
No planner available → `null`, never an invented answer. Sensitive categories
never reach this tier, and pages with "answer in your own words" + AI-content
prohibitions skip it entirely.

**Does the matcher consult an LLM for similarity? No.** Question-to-question
similarity is a deterministic token-set Dice coefficient computed in code
(§4). The LLM tier is only the final fallback for genuinely new non-sensitive
questions — and even there the LLM is a native sub-agent of the host CLI, not
an OpenRouter call.

## 4. The matcher: FAQ reuse by similarity

`lib/application-faq.mjs` reuses previously answered questions (the question
bank in `FAQS.md`) through three tiers:

- **Tier 0 — normalized-exact** match (existing behavior).
- **Tier 1 — whole-store similarity**: token-set score between the current
  question and every stored question. Accept at **score ≥ 0.75 with ≥ 0.15
  lead** over the runner-up.
- **Tier 2 — category-scoped similarity**: same score, but only against stored
  entries whose `category` tag matches the current question's classification
  (fast over a large store, safer — same intent, same category). Records carry
  `category` + `category_source` fields, computed at write time
  (`recordApplicationFaq`), so every future submission grows the bank
  categorized. A backfill tool (`tools/backfill-faq-categories.mjs`) tagged
  the pre-existing store.

The similarity score itself (`similarityScore` in `lib/option-matching.mjs`):

```
score = 0.7 · containment + 0.3 · Jaccard
containment = |A ∩ B| / min(|A|, |B|)
Jaccard     = |A ∩ B| / (|A| + |B| − |A ∩ B|)
```

over a folded token set (lowercase, stopwords and punctuation stripped,
affirmative/negative polarity tokens tagged). Guards:

- **Polarity is a hard exclusion**: a Yes-answer option never matches a
  No-answer question, whatever the overlap.
- **Sensitive gating**: salary/visa/authorization/legal/consent questions are
  excluded from fuzzy matching entirely — only exact, explicitly recorded
  answers are reused for those.
- **Option precedents**: when a stored entry has a chosen option text, that
  text is tried against the current options before similarity is consulted.
- **Conservative option selection**: a fuzzy option match needs a score of
  **0.84** (single-token query) / **0.76** and a **≥ 0.16** lead over every
  alternative, or no choice is made.

## 5. The verify loop: fill → re-fetch → fill leftovers → repeat

Yes — after filling, the form is re-snapshotted from the live DOM and every
mandatory field is re-checked, repeatedly, until clean. Exactly the loop
`prepareFinalStep` runs (up to 12 multi-page steps; per step):

```
for round in 1..verify_rounds (default 3):
    fillSemanticFields()          # FRESH inventory (planVisibleForm)
                                  # + fill pass, vendor-aware
    unresolved = unresolvedRequiredFields()   # FRESH [required] DOM scan
    if unresolved empty: break
# leftovers re-enter the answer ladder (engine → FAQ matcher → sub-agent)
# on every round, because each fill pass re-inventories the form.
```

- Only at **100% mandatory coverage** does the step advance (Next/Continue) or
  hand back the final submit action.
- Immediately before submit, one last `unresolvedRequiredFields` pass gates
  the click: **a step that cannot reach 100% is never submitted half-filled**
  — it is recorded to `data/apply-failures.tsv` and the job is killed and
  skipped.
- Non-mandatory fields stay blank unless an answer exists — mandatory coverage
  is the only gate.
- Rounds cap: `autofill.watchdog.verify_rounds` in `config/profile.yml`
  (env `CAREER_OPS_VERIFY_ROUNDS` overrides; default 3).

## 6. Visa sponsorship mapping (Indian candidate, roles outside India)

The mapping is in place, deterministic, and LLM-gated off:

- **Category `visa-sponsorship`** (`templates/form-categories.yml`, priority
  21, `llm_allowed: false`) matches `require sponsorship`, `sponsorship`,
  `visa sponsor`, `work visa`, `h1b` — with Yes/No option aliases.
- **Contextual resolver** (`form-answer-engine.mjs`): if the question/posting
  names a country, the answer is `No` for India and
  `profile.sponsorshipRequired` for any other country, with a full-sentence
  explanation when the form asks for one; US forms with H-1B option lists get
  `form_answers.sponsorship_type_us` ("Yes, H1B Sponsorship").
- **Sibling categories** cover the rest of the eligibility cluster:
  `work-authorization` (priority 20, `excludes: sponsorship` so the two never
  collide), `work-permit`, `citizenship-nationality`,
  `relocation-willingness`, `location-*`.
- **Profile values** (`config/profile.yml`): `location.authorized_in: ["India"]`,
  `location.needs_sponsorship: true`, `location.visa_status` ("Indian Citizen…
  roles offering visa sponsorship"), per-company `application_answers` for
  company-specific sponsorship wording.
- Because the category is `llm_allowed: false`, the sponsorship answer can
  never be rewritten by a sub-agent.

## 7. Watchdog: 3-minute budget, kill-and-advance

`lib/watchdog.mjs` + config in `config/profile.yml → autofill.watchdog`:

| Key | Default | Meaning |
|---|---|---|
| `job_timeout_seconds` | 180 | pre-submit budget (fill + verify + find submit) |
| `otp_poll_seconds` | 120 | separate OTP email-wait budget (does not consume the job budget) |
| `confirm_deadline_seconds` | 300 | post-submit confirmation window |
| `planner_timeout_seconds` | 120 | SIGTERM cap for the planner child |
| `verify_rounds` | 3 | §5 rounds cap |
| `cooldown_minutes` | 60 | retry cooldown per failed job |

- `raceWithDeadline(task, ms)` races every phase; a hit kills **only the job's
  tab** (`killJobPage` = `page.close({ runBeforeUninstall: false })`), the
  shared context stays for the next job.
- `recordApplyFailure` appends to `data/apply-failures.tsv`
  (`date, company, role, url, reason, phase, elapsed_ms, planner_available,
  epoch_ms` — epoch enables intra-day cooldowns). The tracker gets a
  **note-only** status update, never `Applied`.
- `apply-runner.mjs` skips targets still in cooldown.
- The old trailing `await new Promise(() => {})` hang is gone from the
  autonomous path: the runner exits and moves on.

## 8. OTP flow (email verification codes)

`lib/otp-flow.mjs` replaces the single-shot block:

1. Poll the email (`tools/fetch-verification-code-mail.py` over the macOS Mail
   inbox, 10s interval, 120s budget, company-filtered, since-epoch freshness)
   with the Gmail MCP fallback (`tools/gmail-mcp-server.py`) when Mail has no
   fresh match.
2. **No code in budget → re-click submit** (the form is still filled, fresh
   `submittedAt`), a second poll window, bounded by `confirm_deadline_seconds`.
   Still nothing → `'no-code'`, record, kill, advance.
3. Enter via `enterVerificationCode` (single input → pressSequentially;
   segmented → auto-advance per box, readback verification). On widget
   mismatch, re-detect the inputs (widgets re-render) and retry once.
4. **Verify-click attempts cap = 2** (was 1): on failure clear the inputs,
   re-fetch a **fresh** code, re-enter, re-click.
5. **Post-OTP resubmit** (the "sometimes fails" case): after verify, wait 3s;
   if no confirmation and a visible enabled submit exists, click it (up to 3
   follow-ups).
6. Success = `confirmedSubmission` / ATS confirmation only — email arrival is
   never success.

## 9. Native-only planner dispatch

`lib/planner-dispatch.mjs` — the OpenRouter tier is removed:

1. `CAREER_OPS_NATIVE_SUBAGENT=1` → chat-agent handoff (the host agent services
   the request with its own native sub-agent).
2. Else: headless spawn of the **detected** CLI (`runtimeCli()` + CLI_COMMANDS
   — never cross-vendor).
3. Neither → `PlannerUnavailableError` → the job is recorded as
   failed/skipped, **never guessed**.

`openrouter-runner.mjs` keeps `scan`/`evaluate`/`pipeline` but no longer serves
the form-plan path; `.env.example` marks `OPENROUTER_API_KEY` legacy.
`diagnoseStuckForm` routes through the same dispatch and degrades to a plain
field dump.

## 10. Background autonomous loop

`apply-runner.mjs`:

- Reads targets from `data/last-found-jobs.json` + the Pending section of
  `data/pipeline.md` (deduped by URL).
- Spawns **one `node autofill.mjs <url>` child per job** — a wedged application
  is SIGKILLed at the deadline without losing the rest of the queue. The child
  deadline is `job_timeout + 2·otp_poll + confirm_deadline + 60s`.
- Cooldown skips via `data/apply-failures.tsv`; the tracker gate
  (`Evaluated`-only) still applies inside the child.
- Flags: `--loop --interval <min>` for cron/launchd, `--limit N`, `--dry-run`.
- Recipes in `docs/AUTOMATION.md` (cron every 30 min, launchd plist).

## 11. Safety boundaries (unchanged, enforced)

- Source-of-Truth: keywords reformulated, never fabricated; authorship claims
  non-negotiable; answers come only from `config/profile.yml` / `cv.md` /
  `FAQS.md` (which records provenance on every entry).
- Sensitive/legal/consent/eligibility categories are `llm_allowed: false` —
  deterministic only.
- CAPTCHA always stops the job (never bypassed).
- `Applied` is recorded only after ATS confirmation; killed jobs get a
  note-only tracker update, never `Applied`.
- **Fit-gate override (documented user decision):** this candidate applies to
  ALL jobs passing the 1–5 YOE and location/visa filters — the repo-wide
  "discourage below 4.0/5" quality guidance is deliberately overridden
  (`modes/_custom.md` Rule 9, `.agents/skills/apply-job/SKILL.md` step 8).

## 12. File-by-file changes

**New modules (`lib/`):** `form-categories.mjs` (taxonomy loader + classifier
+ answerPolicy) · `form-answer-engine.mjs` (the 4-tier ladder) ·
`option-matching.mjs` (matcher family + similarity, extracted verbatim) ·
`form-verify.mjs` (verify loop) · `watchdog.mjs` (budgets + failure ledger) ·
`otp-flow.mjs` · `otp-entry.mjs` · `planner-dispatch.mjs` ·
`chat-agent-form-plan.mjs` (moved `loadEnvFile` + planner transport) ·
`education-facts.mjs` (cv.md education parser, profile precedence) ·
`autofill-form-utils.mjs` (shared normalize + location fallback) ·
`application-faq.mjs` (similarity tiers + categorized recording) ·
`active-agent-form-planner.mjs`.

**New:** `templates/form-categories.yml` (53-category taxonomy, no candidate
values) · `apply-runner.mjs` · `tools/dry-run-apply.mjs` +
`templates/ats/test-form.html` (offline end-to-end fixture, synthetic no-PII
profile) · `tools/backfill-faq-categories.mjs` ·
`tools/fetch-verification-code-mail.py` · `tools/gmail-mcp-server.py` ·
`tools/search-jobs-1to5yoe.mjs` · `tools/find-diverse-10.mjs`.

**Modified:** `autofill.mjs` (hardcoded chain → engine, verify loop wired,
watchdog race, prepare-only path, OTP via otp-flow, planner via dispatch) ·
`openrouter-runner.mjs` (form-plan path removed; 429/blacklist logic
untouched) · `modes/apply.md`, `modes/_custom.md` (3-min watchdog rule, fit-gate
override) · `.agents/skills/apply-job/SKILL.md` · `AGENTS.md`,
`DATA_CONTRACT.md` (ledger + runner rows) · `docs/APPLY_AUTOFILL.md`,
`docs/AUTOMATION.md` · `GUIDE/*` (setup keys, workflows, tree) ·
`update-system.mjs` (SYSTEM_PATHS registrations) · `.gitignore` +
`.github/workflows/no-user-data.yml` (FAQS.md, portals.yml guards) ·
tests for the new modules.

**User-layer migration:** hardcoded facts/essays moved out of code into
`config/profile.yml` (`form_answers`, `candidate.education`,
`application_answers`); `autofill.watchdog` config; per-company legal
approvals.

**Deleted (dead weight with hardcoded PII):** `tools/test-canonical-submit.mjs`,
`tools/test-affirm.mjs`, `tools/inspect-canonical.mjs`,
`tools/dump-dropdown-options.mjs`, `tools/test-react-select.mjs`,
`tools/fetch-verification-code.py` (superseded by the Mail-reader variant).

## 13. Verification status

- **Offline end-to-end dry run** (`node tools/dry-run-apply.mjs`): inventory →
  category fill → combobox location city→country fallback → verify loop →
  submit → mock OTP `entered` → confirmation. Exit 0 = full pass, zero PII.
- **Live supervised `--prepare-only` runs** (fill + coverage report, NO
  submit, browser left open for review):
  - Lever (Palantir, London): 56 controls inventoried; identity, links,
    essays, languages, radios, consent all filled, 100% mandatory coverage.
    Found: the Lever location combobox did not uniquely match "Bengaluru,
    Karnataka, India" (fixed in §14.1); marketing-consent checkbox correctly
    left for human review by design.
  - Ashby (Supabase, Remote Global): 12 controls, all filled (8 text fields,
    referral-source radio, age-18 YesNo, resume attached), verify loop clean.
    The planner correctly refused to invent a cross-vendor CLI and the
    deterministic tiers covered everything.
  - Greenhouse (Affirm, Remote Spain — visa sponsorship provided): 18
    controls, 100% mandatory coverage. The visa/eligibility cluster answered
    deterministically — "work remotely from Spain…" authorization question,
    "If you are not an EU citizen, what is your citizenship?" → India, Yes/No
    sponsorship combos from `needs_sponsorship: true`. Found: phone-country
    combobox clicked "India +91" but the registration check read back "India"
    (fixed in §14.2).
- `node test-all.mjs`: all suites green except `openrouter-runner-429-reset`
  (fork drift — the 429/blacklist code is byte-identical to `main`; not part
  of this re-architecture).

## 14. Known gaps / next work

1. **Lever location combobox** (found in the live run above) — fixed:
   `locationSuggestionWithFallback` now scopes a non-unique country match by
   the candidate's city/state and the posting's city (so one "London, United
   Kingdom" wins among many "…, United Kingdom" entries), and the failure
   warning now lists the suggestions the board actually offered. Needs a
   supervised Lever re-run to confirm.
2. **Phone-country combobox registration** (found on Greenhouse) — fixed:
   `registeredOptionMatches` strips trailing dial codes and accepts
   containment, so "India +91" registering as "India" counts as selected.
3. Watchdog demo on a deliberately hung fixture (kill at 3 min + ledger row +
   advance) — pending a fixture.
4. One supervised live submission with real OTP on a test posting (the
   user's call — will pick a real opening and test end-to-end).
5. `data/apply-failures.tsv` tracker-note write-back is note-only by design;
   a future UI could surface the ledger in the dashboard.
