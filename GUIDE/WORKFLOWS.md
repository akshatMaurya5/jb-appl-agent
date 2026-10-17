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
   - Types candidate name, email, phone with international prefix (`+91`), address, city, state, country, and postal code (`560037`).
   - Handles React-Select comboboxes by sending keyboard events, opening the virtualized menu, and selecting exact text matches.
   - Selects demographic responses (Gender, Race, Disability, Veteran Status, Pronouns) according to your saved preferences.
   - Resolves location and visa sponsorship questions (confirming remote authorization, selecting sponsorship required for international onsite).
5. **Open-Ended Written Essay Responses**:
   - If the application asks narrative questions (e.g., *"Why do you want to join our team?"* or *"Describe a challenging distributed systems bug you resolved"*), the runner batches the question to OpenRouter.
   - OpenRouter drafts grounded responses referencing only real achievements from your `cv.md` and `config/profile.yml`.
6. **90-Second Diagnostic Guard**:
   - If form completion has not reached the submit button within 90 seconds, the runner sends visible field states to OpenRouter to diagnose any blockers or missing fields.
7. **5-Minute Timeout Safeguard**:
   - If form preparation exceeds 5 minutes, the job tab is safely closed and the batch proceeds to the next job.
8. **Final Submit**:
   - Clicks the final "Submit Application" button.

---

## Workflow 3: Automated Email OTP / Security Code Solving

When an ATS requires 2FA identity confirmation (such as Greenhouse's 8-character verification code modal):

1. **Modal Detection**: The runner detects the OTP input modal on screen.
2. **Inbox Polling**:
   - **macOS Mail (default)**: The runner triggers an AppleScript query via `tools/fetch-verification-code-mail.py` to check for new security code emails received after the application was launched.
   - **Gmail IMAP**: Alternatively, connects to Gmail via `tools/fetch-verification-code.py` using your Google App Password.
3. **Code Extraction**: Parses the security code (e.g. `K9X2P4L7`).
4. **Input & Confirmation**: Types the code into the modal input field, submits the verification dialog, and waits for the on-page submission confirmation message.
5. **Tracker Ledger Update**: Automatically writes an entry with status `Applied` into [`data/applications.md`](../data/applications.md).

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
