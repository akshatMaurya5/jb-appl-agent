# Job Application Agent (`jb-appl-agent`)
### Autonomous AI Job Search, Browser Autofill, OTP Verification & Pipeline Tracking Engine

A fully autonomous job application automation platform specifically tailored for **Software Engineering** roles (Backend, Distributed Systems, Go, Java, Cloud Infrastructure, Platform, Site Reliability Engineering, and Applied AI). 

Designed to eliminate manual repetitive job application chores while maintaining 100% factual accuracy, strict compliance, and automated email verification solving.

---

## What It Does in Detail

1. **Intelligent Job Discovery (`find-jobs` & ATS Scanners)**:
   - Scans and evaluates public ATS boards (Greenhouse, Ashby, Lever, Workday) with zero token cost.
   - Enforces a strict **1 to 5 years experience filter** (automatically filtering out intern/student roles as well as Staff/Principal/Director positions requiring >5 years of experience).
   - Filters by location policy: Worldwide Remote (open to global applicants) or International Onsite with Visa Sponsorship & Relocation (Europe, UK, US, UAE, Australia, Singapore, Japan).
   - Deduplicates automatically against past pipeline entries and tracked history.

2. **Autonomous Browser Automation (`autofill.mjs` & `apply-job`)**:
   - Launches a real Chromium browser via Playwright.
   - Auto-attaches the candidate's master PDF resume.
   - Pre-fills all personal contact information, dynamic addresses, phone country codes, and links (LinkedIn, GitHub, Portfolio).
   - Handles complex, dynamic form components:
     - **React-Select & Virtualized Comboboxes**: Keyboard navigation, async dropdown fetching, and portal option selection.
     - **Location & City Autocomplete**: Geocoded selection with debounce handling.
     - **EEO & Demographic Surveys**: Automatically fills gender, ethnicity, disability, veteran status, and pronouns in strict adherence to user-defined preferences.
     - **Work Authorization & Sponsorship**: Automatically selects visa sponsorship requirements for international onsite roles, and citizen/work-authorized status for domestic/remote roles.
   - **Open-Ended Written Responses**: Pre-formulates grounded, essay-style answers using facts strictly sourced from the candidate's `cv.md` and `config/profile.yml`.

3. **Stuck-Form Diagnosis & Timeouts**:
   - **90-Second LLM Diagnostic**: If a form remains unsubmitted after 90 seconds, the runner inspects visible field labels, control types, required flags, and dropdown options, sending them to OpenRouter for a grounded diagnosis of blockers and remedies.
   - **5-Minute Per-Job Timeout**: Guarantees the batch runner never hangs indefinitely; if an application cannot be completed within 5 minutes, its tab is safely closed and the batch proceeds.

4. **Automated 2FA Security Code / OTP Handling**:
   - Detects on-page verification screens (Greenhouse 8-character codes, Ashby verification links/codes).
   - Automatically polls the user's inbox via **macOS Mail AppleScript** or **Gmail Assistant MCP / Python tool** without requiring manual intervention.
   - Extracts the security code, types it into the modal dialog, and completes the submission.

5. **Application Tracking & Visual Interactive Dashboard**:
   - Records every confirmed application into canonical markdown [`data/applications.md`](../data/applications.md).
   - Generates and launches an interactive web dashboard ([`tracker-dashboard.sh`](../tracker-dashboard.sh)) with date-based grouping, company rollups, search filters, and dark/light modes.

---

## Directory Structure

```
├── .agents/skills/
│   ├── apply-job/             # Skill definition for autonomous browser applications
│   └── find-jobs/             # Skill definition for candidate job discovery sweeps
├── config/
│   ├── profile.yml            # Primary candidate profile & targeting configuration
│   └── profile.template.yml   # Template profile configuration for new users
├── GUIDE/
│   ├── README.md              # This overview
│   ├── SETUP.md               # Complete step-by-step setup guide
│   ├── ONBOARDING-QUESTIONS.md# Questionnaire asked to configure a new user
│   └── WORKFLOWS.md           # Operational workflows for discovery & applying
├── tools/
│   ├── fetch-verification-code.py       # Python IMAP email OTP fetcher
│   ├── fetch-verification-code-mail.py  # macOS Mail AppleScript OTP fetcher
│   └── gmail-mcp-server.py              # Gmail MCP server integration
├── autofill.mjs               # Core Playwright autonomous form autofill engine
├── openrouter-runner.mjs      # OpenRouter API client for question answering & diagnosis
├── generate-dashboard.mjs     # Standalone interactive dashboard generator
├── tracker-dashboard.sh       # Shell script to open the web tracker dashboard
├── setup-profile.mjs          # Interactive onboarding setup assistant script
└── portals.yml                # ATS portal query configuration & positive title filters
```
