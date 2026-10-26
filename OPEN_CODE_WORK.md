# OPEN_CODE_WORK.md — autonomous apply rework

**Branch:** `feat/autonomous-apply-rework`
**Scope:** make the autonomous apply pipeline actually finish applications instead of stalling on unanswered questions, and make `find-jobs` rate every job out of 5 against the candidate's profile.
**Status:** implemented, syntax-verified, and behaviour-verified against the real data in this repo. The repo's own test suite was deliberately **not** run (the user asked to skip it: "i dont think running test locally would help us in any way"). Two unit-test expectations were updated earlier to match intentionally improved behaviour and are noted in §11.
**Audience:** the next agent picking this up (Antigravity / Copilot / ChatGPT / Claude / Codex) — this file is written so you do not have to re-derive the diagnosis.

---

## 0. The one question the user asked: *"will it spawn subagent in case of unknown question?"*

**Yes — and before this change it essentially never did.** Specifically:

1. An unknown *ordinary* question that survives the deterministic tiers is sent to `callFormPlanner()` (`lib/planner-dispatch.mjs`), which starts a real agent CLI (`opencode run`, `claude -p`, `codex exec`, `copilot -p`, `qwen -p`, `agy -p`, `pi -p`, `grok -p`, `kimi -p`), feeds it the bounded form inventory + trusted profile/CV + safe FAQ history, and parses back `{answers:[…], choices:[…]}`.
2. Before this change that path was dead in practice: no CLI was ever *detected* for a shell-invoked run (resolution depended on env vars set only when the driver was itself launched by an agent), a single failure disabled planning for the rest of the process, and `maxAttempts` was accepted and ignored.
3. Now: the CLI is resolved from env → profile → runtime marker → **first installed CLI**, the choice and the reason are logged, a rejected plan is retried **with the rejection reason prepended**, a transport that cannot start gets one retry and then the next transport is tried, and nothing latches a failure.
4. Questions that **must not** be delegated are refused, not guessed: legal/consent/attestation, unsupported facts, unreadable labels, and pages that forbid AI-authored answers. Those stay blank and are reported with the reason.

Verified in this environment: `plannerAvailability()` → `{"available":true,"cli":"opencode","binary":"/opt/homebrew/bin/opencode","reason":"…"}`.

---

## 1. How to read this document

| Section | Read it if you want to… |
|---|---|
| §2 | see the measured diagnosis (why the flow stalled) |
| §3 | understand the answer ladder end to end |
| §4 | work on the new modules (`question-context`, `answer-render`, `job-queue`, `failure-artifacts`) |
| §5 | work on the rewritten modules (`application-faq`, `option-matching`, `planner-dispatch`, `active-agent-form-planner`) |
| §6 | know exactly what changed in `autofill.mjs` and where |
| §7 | know why `apply-runner.mjs` now sees the whole queue |
| §8 | change the form taxonomy safely |
| §9 | understand the `/5` rating in `find-jobs` |
| §10 | see the skill-file changes |
| §11 | reproduce the verification runs, and see what was intentionally not run |
| §12 | configure the planner / answer pipeline |
| §13 | find the artifacts a failure leaves behind, and replay one |
| §14 | know what is still missing (honest gaps) |

---

## 2. Diagnosis — what was actually broken (measured, not guessed)

Everything below was measured against this repo's real data before any code changed.

| # | Symptom | Measurement | Root cause |
|---|---|---|---|
| 1 | The runner "never gets through the list" | `apply-runner.mjs:45` matched `^\s*- \[ \]\s+(url)\s*—\s*(.+)` (em dash only). Real queue: **774 of 798** pending lines are pipe format (`- [ ] url \| Company \| Role \| Location`). The runner saw **3** targets. | A parser that refuses to admit a line exists. Downstream retries cannot fix a queue entry that was never read. |
| 2 | Same posting applied to twice | `updateTracker()` appended `- [x] url` only when the URL was absent, so the `- [ ] url` line stayed pending → next cycle re-offered it. | Write side never closed the loop with the queue. |
| 3 | Questions stayed empty although they had been answered before | `findFaqAnswer` cost ~71 ms/call and was called up to 3× per question; paraphrase pairs scored **0.000–0.567** against a **0.75** gate → 0/8 realistic rephrasings resolved. | Only exact text comparison; no intent tier. |
| 4 | "How did you hear about us?" was answered "Job board" | A bad `'job board'` alias in `option-matching`'s alias table hijacked the match. | Alias table had a poisoned entry and no specificity ranking. |
| 5 | Salary questions never filled on banded forms | `50000` vs `[30k-50k, 50k-70k, 70k-90k, 90k+]` → **NO MATCH** on every banded list. | Text similarity was used for a money value. |
| 6 | Questions were unanswerable garbage | `contextFor()` concatenated aria-label + placeholder + name + id + labels + wrapper text with no cleanup → `"start typing... 8f1c2e0a-… question_38511204002"`. `start typing…` was the single most common unanswered question in the 3.6 MB store (25 occurrences). | No noise stripping; wrapper text could decide the entire question. |
| 7 | Failures were undiagnosable | `data/apply-failures.tsv`: 62 rows, **46** of them `unconfirmed-submission` — a reason compatible with ≥4 unrelated causes. Nothing captured the page. | No artifacts. |
| 8 | The planner never ran | Resolution required `CAREER_OPS_FORM_PLANNER_CLI` / `CAREER_OPS_CLI` / a runtime marker; a shell-invoked run has none. `maxAttempts` ignored; first failure set `activeAgentDisabled = true` for the whole process. | Dead code path plus a caller-side latch. |

---

## 3. The answer ladder (what happens between "field is empty" and "a sub-agent answers it")

```
for each control on the form:
  ┌─ 0. readable?           buildQuestionContext() strips noise → isUnreadableQuestion()
  │                          unreadable → report, never plan, never guess
  ├─ 1. explicit answer?    profile.application_answers (per-question override)
  ├─ 2. profile/CV fact?    classify() → category → deterministicAnswer()
  ├─ 3. FAQ reuse?          findFaqMatch(): exact → similarity → intent → intent-similarity → category-similarity
  │                          refused for legal/consent AND for profile-owned text
  │                          essay answers only reusable at the SAME company
  ├─ 4. typed rendering?    renderAnswer(): money→band, duration→band, boolean→"I do/I do not", essay→refuse
  └─ 5. sub-agent?          callFormPlanner() → agent CLI (retries with corrective feedback)
                             still unresolved → typed refusal, field stays blank, submission stops at
                             the mandatory-coverage gate
```

Design rules that must not be violated by future edits:

- **Deterministic first, model last.** The planner is the *last* rung, never the first.
- **The profile is ground truth.** Answers to salary / authorization / visa / demographics / DOB / religion are *never* taken from the FAQ store, because the store is a history of what was typed on other forms (it holds `50000` 23×, `85000` 3× — a reuse rule that is not strict majority would be a coin flip on the candidate's own salary).
- **A refusal is a result, not a failure.** `essay-not-choice`, `choice-not-listed`, `ambiguous-option`, `unsupported-control` are recorded so the ledger says *why* a field stayed empty.
- **Never invent.** No metric, credential, employer, or legal commitment may be produced by any tier.
- **Unreadable ≠ unanswerable.** A field whose whole label is `start typing…` must not consume a planner attempt.

---

## 4. New modules

### 4.1 `lib/question-context.mjs` (160 lines)

**Problem.** Form labels come from six different places (aria-label, placeholder, `name`, `id`, `<label>`, `aria-labelledby`, `<legend>`, ATS wrapper text) and every ATS fills the useless ones with junk. The old `contextFor()` joined all of them verbatim.

**API**

| Export | Purpose |
|---|---|
| `MAX_QUESTION_CHARS = 400` | hard cap on the stored/asked question |
| `buildQuestionContext({labels, legends, wrapper, placeholder, name, id})` | trust-ordered join + noise strip |
| `stripQuestionNoise(text)` | removes placeholders, UUIDs/hex ids, `question_123`, zero-width chars, repeated punctuation, duplicates |
| `isUnreadableQuestion(text)` | true when what remains cannot identify a question |
| `clampQuestion(text)` | truncates to `MAX_QUESTION_CHARS` on a word boundary |
| `questionKey(text)` / `questionTokens(text)` | stable normalized key / token list |

**Behaviour verified**

```js
buildQuestionContext({ labels:['start typing...'], placeholder:'start typing...',
  name:'question_38511204002', id:'8f1c2e0a-1b2c-4d5e-9f00-aabbccddeeff',
  wrapper:'start typing... 8f1c2e0a question_38511204002', legends:[] })  // → "8f1c2e0a"
buildQuestionContext({ labels:['Where did you hear about this role?'], … })  // → "Where did you hear about this role?"
```

(`"8f1c2e0a"` is then rejected by `isUnreadableQuestion`, which is what routes the field to the "report, never plan" branch.)

**Invariants for future edits**

- Wrapper text may *contribute*, never *decide*: a real label always outranks it.
- `stripQuestionNoise` must be conservative with real words — `start` and `typing` are removed only as part of the known placeholder phrases, never as tokens.

### 4.2 `lib/answer-render.mjs` (382 lines) — cross-representation answers

**Problem.** A stored answer used to be one string for one control. The same question as a dropdown ("How did you hear about us? [Career site | Job board | …]") or a radio group had no way to reuse the stored text, and a *choice* label typed into a *text* box was pasted verbatim.

**Model**

```js
{ answer_type: 'enum',    canonical_value: 'company career page' }
{ answer_type: 'boolean', canonical_value: true }
{ answer_type: 'number',  canonical_value: { amount: 50000, currency: '', period: 'year' }, unit: 'salary' }
{ answer_type: 'number',  canonical_value: 30, unit: 'duration_days' }
{ answer_type: 'long_text', canonical_value: '…' }
```

**API**

| Export | Purpose |
|---|---|
| `ANSWER_TYPES` | `boolean`, `enum`, `number`, `text`, `long_text`, `multi` |
| `REFUSAL` | `no-answer`, `essay-not-choice`, `choice-not-listed`, `ambiguous-option`, `unsupported-control` |
| `inferAnswerType(value, {inputType, options, context})` | which type this value is, disambiguated by the question |
| `canonicalizeAnswer(value, opts)` | raw answer → typed canonical value |
| `renderAnswer(answer, {control, options, context, aliases})` | typed value → the control actually on screen |
| `readBoolean`, `readDurationDays`, `readSalary`, `isEssayLike` | primitives (exported for reuse/tests) |

**The four cases that motivated it, all verified after the change**

| Stored answer | Control | Result |
|---|---|---|
| `50000` + "salary expectations" | `30,000 - 50,000 / 50,000 - 70,000 / 70,000 - 90,000 / 90,000+` | → `50,000 - 70,000` (`via: salary-band`) |
| `35000` / `95000` | same list | → `30,000 - 50,000` / `90,000+` |
| `6 LPA` + "expected CTC" | `3-5 LPA / 5-8 LPA / 8-12 LPA` | → `5-8 LPA` |
| `Yes` (authorized) | `I do / I do not` | → `I do` |
| `30 days` | `Immediately / 2 weeks / 1 month / 2-3 months` | → `1 month` (`via: duration-band`) |
| 13-word paragraph | `Yes / No` | → `essay-not-choice` (refused, not mis-picked) |

**Two bugs found while verifying this module (fixed, see §5.2 and §5.3)**

1. `optionPolarity('I do')` returned `null`, so `Yes` could never match the affirmative option on the very common `I do / I do not` radio pair — the negative twin matched, the affirmative did not.
2. `salaryBandContains('3-5 LPA', 600000)` read the range as `3 … 500,000` (the unit attaches only to the last number), so every Indian banded list looked "contained" by every band → `ambiguous-option` on every such field.

### 4.3 `lib/job-queue.mjs` (268 lines) — one parser for every pipeline shape

**Problem.** See §2 rows 1–2. Two independent defects, one on read, one on write.

**API**

| Export | Purpose |
|---|---|
| `LINE_STATE` | `pending` / `done` / `blocked` / `other` |
| `parsePipelineLine(line)` | `{url, state, format, company, role, location}` or `null` |
| `parsePipelineTargets(source)` | pending, unblocked, URL-deduped targets |
| `parseFoundJobs(list)` | `data/last-found-jobs.json` → targets |
| `buildQueue({found, pipeline})` | discovery output first (freshest), then pipeline, deduped by normalized URL |
| `readJobQueue(root)` | read both sources from a data root |
| `isPipelineDone(pipelinePath, url)` | already submitted? |
| `markPipelineSubmitted(path, url, {note, appendIfMissing})` | rewrite `- [ ]` → `- [x] … (submitted {date})`; returns `{changed, action}` |

**Shapes understood**

```
- [ ] https://jobs.ashbyhq.com/cursor/… | Cursor | Software Engineer | Remote
- [ ] https://jobs.lever.co/palantir/… — Palantir (Backend Engineer, London)
- [ ] https://… — Company Name
- [ ] https://…            (freeform, URL only)
```

**Measured after the change:** `data/pipeline.md` has 798 pending + 92 done markers; `buildQueue` + the done-filter yields **794 apply targets** (previously 3).

**Gotchas**

- Company/role extraction is heuristic (parenthetical parsing splits role from location with a location-word heuristic). It is good enough for logging and cooldown keys; never use it as a dedup key — URL normalization is the key.
- `markPipelineSubmitted` rewrites the *first* pending line for that URL. If a URL somehow appears twice as pending, the second stays pending by design (a later cycle will fix it) — do not "fix" this by rewriting all matches, because a deliberate re-queue would be silently erased.

### 4.4 `lib/failure-artifacts.mjs` (145 lines) — evidence for a failed application

**Problem.** See §2 row 7. `unconfirmed-submission` was 46 of 62 ledger rows and could mean four different things.

**Layout**

```
data/apply-runs/{YYYY-MM-DD}-{company-slug}-{hash}/
  meta.json        reason, phase, url, final_url, elapsed_ms, planner availability/detail,
                   inventory_size, unreadable_fields[], choice_refusals[], planner_attempts[], faq_items[]
  inventory.json   every control: key, type, question, options, required, current_value
  page.html        live DOM at failure time
  screenshot.png   what the candidate would have seen (full page)
  transcript.txt   the run's own log lines (bounded 600 lines)
  runner.log       full child output, written by apply-runner.mjs
```

**API:** `artifactSlug()`, `applyRunsRoot(root)`, `captureFailureArtifacts(root, {...})`, `listApplyRuns(root, {filter})`, `readApplyRun(root, name)`.

**Non-negotiable:** capture is best-effort. A failure to write artifacts must never escalate a failed application into a crashed runner (every write is wrapped; the caller also wraps the whole call).

---

## 5. Rewritten modules

### 5.1 `lib/application-faq.mjs` (476 lines)

**Defects fixed** (see §2 row 3): re-parse per call, text-only matching, noise-stored questions, no provenance.

**Now**

- **One cached index**, invalidated by `(mtime, size)` per absolute path; `readReusableFaq()` and every lookup share it. Measured: **1 286** reusable entries, **61 ms** cold load, **1.26 ms** per lookup (was ~213 ms per question).
- **Five tiers** with provenance: `exact` → `similarity` (≥0.75 with ≥0.15 lead) → `intent` → `intent-similarity` → `category-similarity`.
- **`dominantAnswer` = 60 % quorum, min 3 entries** (not unanimity). Real buckets are never unanimous but are unambiguous: referral-source 19 entries → "Company Career Page" ×15; location-city 33 → "Bengaluru" ×27. Unanimity threw all of those away. Essay-shaped and URL-shaped values never qualify.
- **Two hard refusals** at the entry point: `FAQ_LEGAL` (consent/attest/arbitration/background check/GDPR/privacy…) and `FAQ_PROFILE_OWNED` (salary, compensation, ctc, remuneration, visa, sponsor, authoriz/authoris, right to work, work permit, citizenship, nationality, DOB, age, gender, sex, race, ethnicity, religion, disability, veteran, sexual orientation, pronoun). This also restored the pre-existing failing engine contract test ("sensitive questions never reuse").
- **`reusableAt(entry, company)`** — an *essay-shaped* answer is reusable only at the **same company**; a short factual answer is reusable everywhere. Without this, a "why us" essay written for Acme leaked onto Beta Corp's form.
- **Intent vs. similarity arbitration** (added while verifying): when the similarity hit belongs to a **different** category than the question classifies into, a clear intent consensus wins, because classification comes from the question itself while similarity comes from surface wording. Verified effect: `Where did you hear about this position?` now returns `Company Career Page` (intent) instead of `LinkedIn` (a prior form's answer at 0.80 similarity), and all four referral phrasings now agree.
- **Typed writes**: every recorded question carries `key`, `category`, and (when derivable) `answer_type` + `canonical_value`, so a future form can re-render it into a different control (§4.2).

### 5.2 `lib/option-matching.mjs` (518 lines)

- **`ALIASES` exported**, bad `'job board'` alias removed.
- **`rankAliasCandidates`** — scored alias selection with a 0.15 lead requirement, plus `aliasSpecificity`, so a generic alias cannot beat a specific one.
- **`STOP_WORDS` / `SYNONYMS` expanded** (~110 entries) to survive rephrasing. Measured: 5/8 realistic paraphrases ≥0.75 (was 0/8).
- **`salaryBandBounds(optionText, {currency})`** (new, exported) → `{min, max}` / `{min, max:Infinity}` / `{min:0, max}`. Applies the **option-level unit** to unit-less numbers: `"3-5 LPA"` → `{min:300000, max:500000}` (was `3 … 500000`).
- **`salaryBandContains`** now delegates to `salaryBandBounds` with a 2 % tolerance.
- **`optionPolarity`** now understands first-person affirmatives: `I do`, `I am`, `I have`, `I will`, `I can`, `I would`, `I agree`, `we …` → `yes`. Negations still win because the negation branch runs first. This is what makes a stored boolean answer usable on `I do / I do not` radios.
- Verified unchanged behaviour on the classic pairs: sponsorship `Yes/No`, relocation `I am / I am not willing`, notice period `30 days → 1 month`, YOE `2.5 → 1-3`, city `Bengaluru → Bangalore`, referral `Company Career Page → Company career site`.

### 5.3 `lib/planner-dispatch.mjs` (197 lines) — the sub-agent tier

**Defects fixed**

1. `maxAttempts` was accepted and ignored → real attempts now (`autofill.planner.max_attempts`, `CAREER_OPS_PLANNER_MAX_ATTEMPTS`, default **3**).
2. One transport failure set a module-level `activeAgentDisabled = true` for the whole process → **no latching**; per-call stats only.
3. The chat-agent handoff was *preferred* under `CAREER_OPS_NATIVE_SUBAGENT=1` and blocked 180 s → now **opt-in** (`CAREER_OPS_CHAT_HANDOFF=1`, legacy var still honored) and bounded by the planner budget; the CLI transport is the default.
4. No corrective retry → a rejected plan is retried with `CORRECTION — a previous attempt was rejected: …` **prepended to the system prompt**, because a model that ignored the schema once tends to ignore a trailing reminder too.

**API:** `callFormPlanner(systemPrompt, userMessage, {maxAttempts, timeoutMs, profileCli, validateResponse})` → `{content, model, cli, attempts[], via}`; `PlannerUnavailableError` carries `attempts` + `availability`; `plannerStats()` / `resetPlannerStats()` for diagnostics; `plannerAvailability()` re-exported for callers.

**Transport order:** `active-agent-cli` (default) → `chat-handoff` (opt-in only) → `PlannerUnavailableError`.

### 5.4 `lib/active-agent-form-planner.mjs` (294 lines) — CLI resolution

- **`resolvePlanner({profileCli})`** — precedence: `CAREER_OPS_FORM_PLANNER_CLI` → `CAREER_OPS_CLI` → `autofill.planner.cli` (profile) → runtime marker (`OPENCODE=1`, Codex/Copilot/Antigravity markers) → **first installed CLI** in `opencode, claude, codex, copilot, qwen, antigravity, pi, grok, kimi`. Returns `{cli, command, binary, reason}` and **logs the reason**, so the substitution is never silent.
- **Deliberate policy change** from the old "never launch another vendor's CLI": that rule existed so Copilot would not silently start Antigravity. It still holds when a CLI is *configured explicitly*. When **nothing** is configured, an installed CLI that can answer beats a guaranteed-unanswered required field — and the choice is logged. `CAREER_OPS_PLANNER_NO_AUTODETECT=1` restores the strict behaviour.
- **Timeout** comes from `autofill.planner.timeout_seconds` / `CAREER_OPS_PLANNER_TIMEOUT_SECONDS` / per-call option (default 120 s). Previously hardcoded.
- **Argv safety** — prompts larger than 60 000 chars go to the child's **stdin** (`claude -p`, `codex exec -`, `pi -p`, …); prompts are bounded at 400 000 chars with the FAQ history trimmed to this form's questions first. Without this a large profile produced `E2BIG` and an unanswerable question.
- **Isolation** — minimal env (no API keys / mail credentials), `cwd` = tmpdir except for Qwen (needs the repo to discover `.qwen/agents`), `windowsHide`, 1 MB output cap.
- `callAntigravityFormPlanner` remains as a backward-compatible alias.

---

## 6. `autofill.mjs` wiring (2155+ lines) — every change, in order

| Location | Change | Why |
|---|---|---|
| imports (~16–30) | `callFormPlanner, plannerAvailability`; `findFaqMatch` (was `findFaqAnswer`); `buildQuestionContext, isUnreadableQuestion`; `renderAnswer, REFUSAL`; `captureFailureArtifacts`; `isPipelineDone, markPipelineSubmitted`; `classify` | new tiers |
| `resolveChoice` / `resolvedChoice` (~117) | new helpers: `matchOptions` first, then typed `renderAnswer`, then the legacy matcher as a last resort; returns typed refusal info | cross-representation + never abort a fill pass |
| `contextFor` (~151) | rebuilt on `buildQuestionContext` with a documented source-trust order | §4.1 |
| `planVisibleForm` (~188) | inventory items get `item.category = classify(...)`; `target._lastInventory = inventory`; FAQ recording uses `findFaqMatch` with `{category, company}` and records `via`/`category`; unreadable questions are filtered out of the planner input and recorded as `target._unreadableFields`; planner call passes `profileCli`/`maxAttempts`/`timeoutMs` from the profile and records `target._plannerVia`; failure records `target._plannerError = {message, attempts, availability}` and prints the fix | planner correctness + diagnosability |
| `fillSemanticFields` select branch (~536) | typed second attempt + deferred typed refusal | salary bands / booleans |
| combobox branch (~682) | same, control `combobox` | React-Select |
| radio branches (~747, ~795) | same, control `radio-group` | `I do / I do not` |
| `updateTracker` (~1790) | uses `markPipelineSubmitted` (rewrite, not append) | §2 row 2 |
| `captureJobFailure` (~2127) | **new** helper wrapping `captureFailureArtifacts` with company/role/url, planner detail, inventory, transcript, and `extra: {unreadable_fields, choice_refusals, planner_via, planner_attempts, planner_availability, faq_items}` | evidence |
| `run()` (~2155) | console tee into a bounded 600-line buffer; `isPipelineDone()` skip guard before liveness; `captureJobFailure()` before `killJobPage()` on `job-timeout`, `no-form`, `unconfirmed-submission` | transcript + duplicate guard |

**Deferred-refusal rule (important):** a typed refusal is recorded **only if the field is still unresolved after every fallback**. Recording it eagerly put "choice-not-listed" into the artifacts for fields that a later tier (legal-acknowledgement, privacy, planner choice) filled correctly — an artifact that lies is worse than no artifact.

---

## 7. `apply-runner.mjs` rewrite (213 lines)

- Uses `readJobQueue(root)`, then filters `isPipelineDone()` → **794** targets instead of 3.
- Every child's full stdout/stderr is written to `data/apply-runs/{slug}/runner.log` (best-effort), so a `child-error` row in the ledger can be read instead of guessed.
- Kept: per-job child process (so a wedged application is `SIGKILL`-able without losing the queue), watchdog-derived deadline, `cooldown_minutes` skip via `recentFailureFor`, `--limit/--loop/--interval/--dry-run`.
- `runner-timeout` / `child-error` are still recorded to `data/apply-failures.tsv` with the same phase taxonomy.

---

## 8. `templates/form-categories.yml` (57 categories)

| Change | Reason |
|---|---|
| `referral-source` patterns extended: `how did you (first\|originally) hear`, `where did you (first\|originally) hear`, `hear about (us\|this\|the)`, `source of (your )?application` | "How did you **first** hear about us?" classified `unclassified`, while "How did you hear about this role?" classified correctly — so the intent tier was unavailable for exactly the phrasing most ATSs use |
| **new `referral-person`** (`priority 89`, `answer.source: none`) for `who referred / referred by / referrer / referral name / name of (the )?referrer / employee …refer` | "Who referred you?" shares the word *referral* with "how did you hear" but asks for a **person**. Sharing the bucket pasted the dominant channel answer ("Company Career Page") into a referrer field. The profile holds no referrer, so the honest outcome is an empty field |
| `identity-name` `excludes` + `'refer'` | the broad `\bname\b` pattern claimed "Referral name" (priority 40 < 89) and would have typed the candidate's own name into a referrer field |
| `location-city` patterns + `currently based` | "Where are you currently based?" fell to `location-autocomplete` (priority 33) instead of `location-city` (30), losing the city intent tier |
| `work-authorization` expanded (British spellings, right to work, legal right) | "right to work" must classify as authorization, not as a work permit |
| `salary-expectation` expanded (desired compensation, ctc, remuneration) | CTC phrasing is standard in Indian postings |
| `links` expanded (bare portfolio/twitter) + excludes for sourcing questions | "portfolio" as a question must not catch "where did you find our portfolio" |
| new `demographics-age`, `demographics-religion` (`answer.source: none`, `llm_allowed: false`) | must be refused, never planned |
| new `skills-technologies` (list-shaped asks only) | "primary programming languages" is a skills list, not a spoken-language question |
| `work-permit` no longer claims "right to work" | was stealing authorization questions |

Verified classification after the change: `current-company`, `work-authorization`, `visa-sponsorship`, `salary-expectation`, `skills-technologies`, `yoe-numeric`, `notice-period`, `referral-source`, `referral-person`, `location-city`, `identity-name` all resolve to the intended category; `taxonomy.categories.length === 57` and the taxonomy still validates (`sensitive && llm_allowed` throws).

---

## 9. `find-jobs.mjs` — the `/5` rating

**Requirement (user):** *every job found must be rated out of 5 based on match to the profile; the score means the chance of being shortlisted / getting an interview call.*

- `calculateShortlistScore(entry, jdVerdict)` now returns `{ score, rationale }` instead of a bare number.
- Score is a **profile-match** score, weighted: core stack (Go/Java/Kafka/distributed) `+1.5` > Python/Node/TS `+1.2` > backend-title-only `+0.8`; YOE band fit `+0.6…+0.2`; worldwide remote / sponsorship `+0.4`; freshness `+0.3…+0.1`; disqualifiers (niche sole stack) `−1.8`; clamped to `0.0–5.0` with one decimal.
- Each fired component appends a human phrase, e.g. `core stack (Go/Java/Kafka/distributed); YOE band 2-4 yrs fits 2.5; worldwide remote; posted within 3 days`.
- `data/last-found-jobs.json` entries gained **`score_rationale`** next to `shortlist_score` (the batch `/apply-job all` consumes).
- Console output now prints `Shortlist Chance: 4.6/5.0` **and** `Score rationale: …` per job.

---

## 10. Skill files (user-requested)

### `.agents/skills/apply-job/SKILL.md`
- **Principle 2 rewritten**: `CAREER_OPS_NATIVE_SUBAGENT=1` is no longer the launch recipe. The planner is an installed agent CLI resolved env → profile → autodetect (logged), and the chat handoff is opt-in (`CAREER_OPS_CHAT_HANDOFF=1`). The old "never launch another vendor's CLI" sentence is gone because it contradicted the new resolution.
- **Principle 3** ladder extended with step (4) "classify → render into the control actually present" and the essay-same-company rule.
- **Principle 4** documents corrective retries and "a transport that cannot start is retried once, then the next transport".
- **Principle 5** documents **typed answers beat text similarity**, with the type list and the four refusal codes.
- **New sections**: *Unknown questions: the answer ladder* (the six rungs, with what each refuses), *Planner configuration* (table of every knob and default), *Failure artifacts and replay* (artifact table + `tools/replay-apply.mjs`), *Queue and duplicate safety* (both pipeline shapes, `- [x]` rewrite).
- End-to-end step 7 now mentions `data/apply-runs/`.

### `.agents/skills/find-jobs/SKILL.md`
- Frontmatter description now states that **every** job is rated out of 5 (score = shortlist/interview-call probability) with a written rationale.
- Principle 3 retitled **"Shortlist Probability Scoring (0 to 5 Scale) — REQUIRED FOR EVERY JOB"**, with the explicit meaning, the four weighted components, a literal output example (`Match: 4.6/5.0` + `Why: …`), and a rule that a job is never presented without its rating.
- Workflow step 4/5 updated: the JSON now includes `score_rationale`, and the printed list must keep each rating intact when presented to the user.

---

## 11. Verification performed (and what was deliberately skipped)

**Run (all green):**
```bash
node --check autofill.mjs apply-runner.mjs find-jobs.mjs tools/replay-apply.mjs \
  lib/{job-queue,planner-dispatch,active-agent-form-planner,failure-artifacts,application-faq,answer-render,question-context,option-matching,form-answer-engine}.mjs
node --input-type=module -e "await import('./autofill.mjs')"     # link check: imports resolve, run() exits on the missing target argument
node -e "…import('./lib/*.mjs')…"                               # every named import exists
node --input-type=module -e "…readTargets()…"                    # 794 targets
node --input-type=module -e "…buildQueue()…"                     # 798 pending / 92 done parsed
node --input-type=module -e "…findFaqAnswer ×200…"               # 61 ms cold load, 1.26 ms/lookup, 1286 reusable items
node --input-type=module -e "…renderAnswer/renderChoice cases…"  # salary bands, LPA bands, boolean radio, duration, essay refusal
node --input-type=module -e "…findFaqMatch with classify()…"     # referral-source intent ×4 phrasings, notice-period, current-company, city
node tools/replay-apply.mjs --latest                             # replay against a synthetic captured run (fixture removed afterwards)
```

**Not run:** `test-all.mjs` and the `tests/*.test.mjs` suite, at the user's explicit request. Two test expectations were updated earlier to match intentionally improved behaviour and should be reviewed by whoever runs CI:
- `tests/form-categories.test.mjs` — "right to work" expects `work-authorization` (was `work-permit`); "primary programming languages" expects `skills-technologies` (was `languages-primary`). File passes 95/0 as updated.
- `tests/form-answer-engine.test.mjs` — passes 7/0; its "sensitive questions never reuse" case is what the `FAQ_PROFILE_OWNED` gate fixes (it was failing at HEAD).

---

## 12. Configuration reference

| Setting | Env | Profile / config | Default |
|---|---|---|---|
| Planner CLI | `CAREER_OPS_FORM_PLANNER_CLI`, `CAREER_OPS_CLI` | `autofill.planner.cli` | autodetect |
| Disable autodetect | `CAREER_OPS_PLANNER_NO_AUTODETECT=1` | — | off |
| Attempts per transport | `CAREER_OPS_PLANNER_MAX_ATTEMPTS` | `autofill.planner.max_attempts` | 3 |
| Planner timeout | `CAREER_OPS_PLANNER_TIMEOUT_SECONDS` | `autofill.planner.timeout_seconds` | 120 s |
| Chat handoff | `CAREER_OPS_CHAT_HANDOFF=1` (legacy `CAREER_OPS_NATIVE_SUBAGENT=1`) | — | off |
| Job budget | — | `autofill.watchdog.job_timeout_seconds` | 180 s |
| OTP poll | — | `autofill.watchdog.otp_poll_seconds` | 120 s |
| Confirm deadline | — | `autofill.watchdog.confirm_deadline_seconds` | profile |
| Verify rounds | — | `autofill.watchdog.verify_rounds` | 3 |
| Cooldown | — | `autofill.watchdog.cooldown_minutes` | profile |

**This machine's state:** no `CAREER_OPS_*` planner vars in `.env` (only `GMAIL_USER`, `GMAIL_APP_PASSWORD`, `OPENROUTER_API_KEY`), so **autodetect is what makes planning fire**; `opencode` is installed and is what gets chosen.

---

## 13. Debugging a failed application

```bash
ls data/apply-runs/                                  # newest last, names are date-company-hash
node tools/replay-apply.mjs --latest                 # re-run classification + FAQ tiers offline
node tools/replay-apply.mjs --latest --unresolved    # only the fields today's rules still cannot fill
node tools/replay-apply.mjs --run 2026-10-26-acme-a1b2c3
```

`meta.json` answers "why did it fail"; `inventory.json` answers "what did it see"; `transcript.txt` answers "what did it decide"; `screenshot.png`/`page.html` answer "what did the page actually look like".

**Replay limitation (by design):** it replays the *classification* and *FAQ* tiers only. The profile tier's loader lives inside `autofill.mjs` (which executes `run()` on import), and duplicating it in a tool would drift. So `no-category`/`no-faq` in a replay does **not** prove the field was unfillable on the live run — read it with `current_value` and the transcript.

---

## 14. Honest gaps / next steps

1. **No `lib/handoff-queue.mjs`.** An unattended run cannot pause for a human and resume; the opt-in chat handoff blocks instead. A persistent request/response queue (write request → exit → next run picks up the answer) is the right fix for a fully autonomous batch and is not implemented.
2. **`tools/replay-apply.mjs` does not replay the profile tier** (§13) — extracting the profile loader into `lib/candidate-profile.mjs` would fix it and is a mechanical refactor, not done here because `autofill.mjs` runs on import.
3. **Location trust/`location-autocomplete` vs `location-city` overlap** is now resolved by priority, not by intent. If a future form wordings both patterns, revisit.
4. **The FTS/`unclassified` tail.** 521 of the store's entries are `unclassified`; the intent tier cannot help those. They need taxonomy coverage, not code.
5. **No test was added** for the new modules (per the user's instruction to skip tests). The highest-value additions would be: `answer-render` cross-representation table (§4.2), `job-queue` both shapes + `markPipelineSubmitted` idempotency, `planner-dispatch` corrective-retry path, `application-faq` intent-vs-similarity arbitration.
6. **`update-system.mjs` now ships the new files** (`lib/answer-render.mjs`, `lib/question-context.mjs`, `lib/job-queue.mjs`, `lib/failure-artifacts.mjs`, `tools/replay-apply.mjs`) — keep that list in sync with any further additions or an update will prune them.

---

## 15. File inventory

**Added**
```
lib/question-context.mjs      160  question text: sources, noise strip, readability
lib/answer-render.mjs         382  typed answers → any control, typed refusals
lib/job-queue.mjs             268  pipeline parsing (both shapes) + submitted marking
lib/failure-artifacts.mjs     145  data/apply-runs/ capture + read-back
tools/replay-apply.mjs        129  offline replay of classification/FAQ tiers
```

**Modified**
```
autofill.mjs                  +340/−   driver wiring (§6)
apply-runner.mjs               +113   queue parsing, child logs (§7)
find-jobs.mjs                  +343   /5 rating + rationale (§9)
lib/application-faq.mjs        +451   cached typed store, intent tier (§5.1)
lib/option-matching.mjs        +244   aliases, salary bounds, polarity (§5.2)
lib/planner-dispatch.mjs       +210   real retries, no latch, opt-in handoff (§5.3)
lib/active-agent-form-planner.mjs +220 CLI autodetect, timeout, stdin, isolation (§5.4)
lib/form-answer-engine.mjs      +13   passthrough of category+company into FAQ tier
templates/form-categories.yml  +126   taxonomy (§8)
templates/states.yml                   (unchanged; referenced for statuses)
update-system.mjs                +5   register new system files
.agents/skills/apply-job/SKILL.md    +69   mapper-level docs (§10)
.agents/skills/find-jobs/SKILL.md    +87   /5 rating contract (§10)
tests/form-categories.test.mjs        # 2 expectations aligned with the new taxonomy
tests/find-jobs-location-mode.test.mjs (untracked; covers locationMatchesMode default/india, dated 2026-10-20)
tracker-dashboard.html                 # incidental 1-line change already in the tree
```

**Left untouched on purpose:** `lib/watchdog.mjs` (its `recentFailureFor` already tolerates new reason codes), `lib/form-verify.mjs`, `lib/otp-*.mjs`, `merge-tracker.mjs`, and the FAQS.md store itself (data is user-owned; only the code that reads/writes it changed).

---

## 16. Rules for the next agent

1. **Do not put answers in the FAQ store for profile-owned questions.** Salary, authorization, visa, demographics, DOB — profile only. The gate is `FAQ_PROFILE_OWNED` and it is also a test contract.
2. **Do not make the planner the first rung.** If a new question type keeps failing, add a category or an alias, not another LLM call.
3. **Do not record a refusal for a field that got filled.** Deferred recording is deliberate (§6).
4. **Do not "fix" `markPipelineSubmitted` to rewrite every matching line.** One deliberate re-queue must survive.
5. **Do not loosen `isUnreadableQuestion`.** Sending `start typing…` to a model produces confident nonsense and burns an attempt.
6. **Keep `data/apply-runs/` best-effort.** A capture failure must never fail a run.
7. **Log the planner choice.** A silent vendor substitution is exactly the behaviour this rework removed.
