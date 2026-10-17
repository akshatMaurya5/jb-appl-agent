# Setup & Installation Guide

This guide details everything required to set up `jb-appl-agent` on your machine so the autonomous job application engine can run end-to-end.

---

## 1. Prerequisites

Before starting, ensure you have the following installed:
- **Node.js**: Version 20.0.0 or higher (`node -v`)
- **npm**: Version 10+ (`npm -v`)
- **Python**: Version 3.10+ (`python3 --version`)
- **Git** & **GitHub CLI**: (`git --version`, `gh --version`)
- **Operating System**: macOS (recommended for native Mail.app OTP polling) or Linux/WSL2.

---

## 2. Installation Steps

### Step 1: Clone the Repository & Install Node Dependencies
```bash
git clone https://github.com/akshatMaurya5/jb-appl-agent.git
cd jb-appl-agent
npm install
```

### Step 2: Install Playwright Browsers
The autonomous runner uses Playwright with Chromium to interact with job application portals:
```bash
npx playwright install chromium
```

---

## 3. API Key & Environment Configuration (`.env`)

Create a `.env` file in the repository root:
```bash
cp .env.example .env
```

Add your credentials to `.env`:
```env
# OpenRouter API Key (used for answering open-ended essay questions & stuck-form diagnostics)
OPENROUTER_API_KEY=your_openrouter_api_key_here

# Optional: Preferred OpenRouter model (defaults to high-throughput free models)
OPENROUTER_MODEL=meta-llama/llama-3.3-70b-instruct:free

# Gmail IMAP Credentials (if using Python IMAP OTP extraction instead of macOS Mail)
GMAIL_ADDRESS=your_email@gmail.com
GMAIL_APP_PASSWORD=your_16_char_google_app_password
```

> **Where to get an OpenRouter key:** Sign up for free at [openrouter.ai](https://openrouter.ai/), create an API key, and paste it into `.env`. The runner defaults to free high-quality models (like Llama 3.3 70B, Qwen 2.5 72B), so there are no mandatory API costs.

---

## 4. Mail Reader Setup (Automated OTP & 2FA Solving)

Many modern ATS platforms (Greenhouse, Ashby, etc.) send a one-time verification security code (usually 6 to 8 alphanumeric characters) to your email before completing the submission. The runner can extract these codes automatically.

Choose **one** of the two supported approaches:

### Option A: macOS Mail.app (Recommended on Mac — Zero Token Cost)
- Open the built-in **Mail** application on your Mac (`/System/Applications/Mail.app`).
- Add the email account you use for job applications (e.g., your Gmail, iCloud, or Outlook address).
- Ensure Mail is running in the background.
- When an OTP is requested, `autofill.mjs` executes a fast, local AppleScript via `osascript` to query your Mail inbox, parse security codes from Greenhouse or the hiring company, and enter the code into the form automatically.
- **Permission requirement:** The first time it runs, macOS will ask to grant Terminal / your IDE permission to control Mail.app. Click **Allow**.

### Option B: Gmail IMAP with App Password (Cross-Platform)
- Go to your [Google Account Security Settings](https://myaccount.google.com/security).
- Enable 2-Step Verification if not already active.
- Navigate to **App passwords** (search "App passwords" in the Google account search bar).
- Create a new App Password named `CareerOps`.
- Copy the 16-character password into `.env`:
  ```env
  GMAIL_ADDRESS=your.name@gmail.com
  GMAIL_APP_PASSWORD=abcd efgh ijkl mnop
  ```
- The helper script [`tools/fetch-verification-code.py`](../tools/fetch-verification-code.py) will connect securely over SSL IMAP (`imap.gmail.com:993`) to retrieve incoming verification emails.

---

## 5. Candidate Profile & Master CV Setup

The autonomous agent strictly obeys the **Source-of-Truth Boundary**: it **never fabricates** credentials, degrees, previous employers, or technical skills. It fills application forms exclusively from your profile configuration.

### Option 1: Run the Interactive Setup Assistant (Fastest)
Run the automated onboarding setup script:
```bash
node setup-profile.mjs
```
The assistant will guide you through all required questions (personal details, address, demographics, work authorization, salary policy, and resume PDF location) and automatically write [`config/profile.yml`](../config/profile.yml) and [`cv.md`](../cv.md).

### Option 2: Manual Configuration
1. Copy the profile template:
   ```bash
   cp config/profile.template.yml config/profile.yml
   ```
2. Open [`config/profile.yml`](../config/profile.yml) in your editor and fill in your details:
   - **`full_name`**, **`email`**, **`phone`**, **`city`**, **`state`**, **`country`**, **`postal_code`**
   - **`resume_path`**: Absolute path to your master resume PDF (e.g. `/Users/yourname/Documents/Resume.pdf`).
   - **`linkedin`**, **`github`**, **`portfolio_url`**
   - **`demographics`**: Gender, race/ethnicity, veteran status, disability, pronouns.
   - **`work_authorization`**: Countries where you have legal work rights and sponsorship requirements for international onsite roles.
   - **`years_of_experience`**: Current years of experience (e.g. `2.5`).
   - **`salary_form_policy`**: Numerical and text defaults for salary input fields.
3. Create your master CV markdown file at `cv.md`:
   - Summarize your work history, education, key projects, and metrics.
   - The OpenRouter assistant reads `cv.md` to craft authentic, grounded answers to open-ended application questions (e.g., *"Describe a time you handled a distributed systems outage"*).

---

## 6. Verifying the Setup

Run the following checks to confirm everything is operational:

```bash
# 1. Verify JavaScript syntax & dependencies
node --check autofill.mjs && node --check generate-dashboard.mjs

# 2. Test the interactive application tracker dashboard
./tracker-dashboard.sh
```

If the dashboard opens in your browser with your profile header, the system is fully configured and ready to apply to jobs!
