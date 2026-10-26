# Operational Workflows Guide

This document describes how to execute the day-to-day autonomous workflows: finding new roles, running end-to-end applications, solving email OTP verification codes, and viewing the interactive dashboard.

---

## Workflow 1: Finding New Software Engineering Jobs

### Method A: Autonomous Agent Sweep (`/find-jobs`)
In your agent chat interface (or Claude / Antigravity CLI), run:
```bash
/find-jobs 5
```
Or specify a custom count or keyword:
```bash
/find-jobs 10
/find-jobs Go Distributed Systems
```

**What happens automatically:**
1. **Reads Existing Tracker & Deduplication History**: Checks [`data/applications.md`](../data/applications.md), [`data/pipeline.md`](../data/pipeline.md), and [`data/scan-history.tsv`](../data/scan-history.tsv). Any previously tracked URL is skipped.
2. **Title & Seniority Filtering**: Matches against active SWE keywords (Software Engineer, SDE, Backend, Distributed Systems, Go, Java, SRE, Platform) and enforces the **strict 1 to 5 years experience filter**. Staff/Principal/Director roles requiring >5 years are disqualified.
3. **Location & Sponsorship Gate**: Selects Worldwide Remote roles open to global applicants, or international onsite roles in Europe, UK, UAE, Singapore, Japan, etc. offering verified visa sponsorship.
4. **Writes Batch File**: Saves the newly discovered opportunities to `data/last-found-jobs.json` and `data/pipeline.md` under `## Pending`.
5. **Displays Numbered Action List**:
   ```
   [1] Parloa — Senior Software Engineer (Berlin · Full Visa Sponsorship)
   [2] Hume AI — Senior Platform Engineer (Remote US / Worldwide)
   [3] Speechmatics — ML Platform Engineer (London, UK · Skilled Worker Visa)
   ```

### Method B: Zero-Token ATS Portals Scanner (`scan.mjs`)
To run a fast zero-LLM scan of all tracked companies configured in [`portals.yml`](../portals.yml):
```bash
node scan.mjs
```
The scanner checks public Greenhouse, Ashby, and Lever APIs with zero token consumption and appends new matches into `data/pipeline.md`.

---

## Workflow 2: Autonomous End-to-End Application (`/apply-job`)

### Applying to All Newly Found Jobs
Immediately after running `/find-jobs`, apply to the entire batch autonomously:
```bash
/apply-job all --auto-submit
```

### Applying to a Single Specific Job
To apply to only one job from the discovered list:
```bash
/apply-job 1 --auto-submit
/apply-job "Hume AI" --auto-submit
```

### What Happens During Autonomous Execution:
1. **Browser Launch**: Playwright launches Chromium in a dedicated browser window.
2. **ATS Preflight & Form Detection**: Navigates to the posting URL, verifies the posting is active, and detects application fields.
3. **Resume PDF Upload**: Automatically attaches your master resume PDF configured in `config/profile.yml`.
4. **Data Input & Disambiguation**:
   - Types candidate name, email, phone, address, city, state, country, and postal code from `config/profile.yml` (the postal value also answers PIN/ZIP labels).
   - Handles React-Select comboboxes by sending keyboard events, opening the virtualized menu, and selecting exact text matches; location comboboxes fall back from city to a unique state option, then a unique country option, when the board has no city entry.
   - Selects demographic responses (Gender, Race, Disability, Veteran Status, Pronouns) according to your saved preferences.
   - Resolves location and visa sponsorship questions (confirming remote authorization, selecting sponsorship required for international onsite).
5. **Answer Ladder (no external LLM tier)**:
   - Deterministic questions are answered by the category engine (`lib/form-answer-engine.mjs`) straight from `config/profile.yml`/`cv.md`; reusable Q&A pairs come from the FAQ similarity tiers in `FAQS.md`.
   - Leftover ordinary narrative questions (e.g., *"Why do you want to join our team?"*) go to the **active host's native sub-agent only** — never a cross-vendor CLI or an OpenRouter API call. The sub-agent drafts grounded responses referencing only real achievements from your `cv.md` and `config/profile.yml`, and returns explicit `unsupported` rather than inventing.
6. **Two-Stage Verify Loop**:
   - After the fill pass, the runner re-inventories the visible form, refills every still-empty required field, and re-checks — up to 3 rounds. It submits only at 100% mandatory coverage; a step that cannot get there is recorded in `data/apply-failures.tsv` and the job is skipped, never submitted half-filled.
7. **3-Minute Watchdog & Kill-and-Advance**:
   - If form preparation exceeds the watchdog budget (`autofill.watchdog.job_timeout_seconds`, default 180s), the job tab is closed, the failure is appended to `data/apply-failures.tsv`, and the batch proceeds to the next job. Failed jobs are skipped during the cooldown window so retry storms are impossible.
8. **Final Submit**:
   - Clicks the final "Submit Application" button and records `Applied` only after the ATS confirms the submission.

### Background Autonomous Loop (`apply-runner.mjs`)

To run the whole find → apply pipeline unattended, run the background runner after a discovery batch has populated `data/last-found-jobs.json` / `data/pipeline.md`:

```bash
node apply-runner.mjs --dry-run         # print the plan, spawn nothing
node apply-runner.mjs --limit 3         # apply to at most 3 targets, once
node apply-runner.mjs --loop --interval 30   # repeat cycles every 30 min
```

Each target runs as its own `node autofill.mjs <url>` child process with a SIGKILL deadline derived from the watchdog config, so a wedged application can never block the queue. Targets with a recent failure in `data/apply-failures.tsv` are skipped while in cooldown.

---

## Workflow 3: Automated Email OTP / Security Code Solving

When an ATS requires 2FA identity confirmation (such as Greenhouse's 8-character verification code modal):

1. **Modal Detection**: The runner detects the OTP input modal on screen.
2. **Inbox Polling**:
   - **macOS Mail (default)**: The runner triggers an AppleScript query via `tools/fetch-verification-code-mail.py` to check for new security code emails received after the application was launched.
   - **Gmail IMAP**: Alternatively, connects to Gmail via the `gmail-assistant` MCP server (stdlib JSON-RPC server in `tools/gmail-mcp-server.py`) using your Google App Password.
3. **Code Extraction**: Parses the security code (e.g. `K9X2P4L7`). OTPs can be numeric or alphanumeric; the runner never assumes six digits.
4. **Input & Confirmation**: Types the code into the modal input field, submits the verification dialog, and waits for the on-page submission confirmation message. The OTP email wait is a separate 2-minute budget that does not consume the per-job budget; if no code arrives, the runner re-clicks submit once and polls a second window before giving up. A failed verify click clears the boxes and re-fetches a fresh code (max 2 attempts), and after verification the runner follows up on a still-visible submit action up to 3 times.
5. **Tracker Ledger Update**: Writes an entry with status `Applied` into [`data/applications.md`](../data/applications.md) only after the ATS confirms the submission.

---

## Workflow 4: Visual Interactive Dashboard

Whenever you want to inspect your applications, review timeline velocity, or filter by company:

```bash
./tracker-dashboard.sh
```

**Dashboard Capabilities:**
- **Collapsible Date Sidebar**: Quick jump across application dates (`Oct 17, 2026`, `Oct 16, 2026`) with applied and total count badges.
- **Collapsible Day & Company Sections**: Click any date or company header to expand or fold roles.
- **Instant Search**: Real-time keyword search across companies, roles, locations, and notes.
- **Status Filter**: Toggle between `All`, `Applied`, and `Evaluated`.
- **View Toggle**: Switch between **Daily Grouped Cards** and full sortable **Table View**.
- **CSV Export**: Click `Export CSV` to download your application ledger.
- **Theme Switcher**: Instant Dark / Light mode toggle.
