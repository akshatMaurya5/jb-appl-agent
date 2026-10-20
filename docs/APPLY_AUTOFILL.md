# ATS Auto-Fill Flow (Apply Mode)

The `apply` mode interactive assistant helps you fill out applications for job postings. It reads the form questions in your browser and drafts personalized answers based on your profile and the evaluated report.

**Direct apply requests run end to end.**
A direct request to apply to a role or a defined batch authorizes the agent to fill and submit the form and complete fresh email OTP verification when available. Search or evaluation alone does not authorize an application. Unsupported required facts, CAPTCHA/Turnstile, and terms that need action-time human confirmation pause the workflow. The tracker changes to `Applied` only after ATS confirmation.

---

## 1. How It Works Per ATS

We have field-tested the auto-fill flow across several major ATS platforms (Ashby, Greenhouse, Lever, and Workable). The agent adapts its behavior to handle ATS-specific controls, and checks the live control state after selection rather than treating a click or typed search text as proof of a saved answer.

### Ashby

- **Duplicate Prevention:** Ashby merges candidates based on their email. Before filling out the form, the agent checks if you've already applied to this company. If so, it warns you and suggests a modified email alias (like `you+teamname@domain.com`) to prevent silent failures or unintended profile merges.

### Lever

- Profile location is searched through Lever's autocomplete and selected only when one visible suggestion matches the candidate's city (using state/country details to disambiguate). Typed location text without a registered suggestion does not satisfy the required-field check.
- Custom radio, checkbox, and dropdown choices are made only when a unique option matches supported profile-backed information, then verified against the control state. Legal, consent, or unsupported questions remain unresolved for review.
- CAPTCHA challenges are never bypassed. If one appears, complete it in the visible browser; if selection or submission cannot be verified, the tab remains open and the tracker is not marked `Applied`.

### Generic controls and submission

- Native selects, radio groups, and custom/ARIA comboboxes are checked after interaction. Search text in a combobox is not treated as a selected option.
- For unanswered ordinary fields, the workflow checks trusted profile/CV answers first, then exact safe `FAQS.md` matches, and sends only what remains to the active host's native subagent. Sensitive, legal, eligibility, and consent questions are not delegated.
- A final submit action is distinguished from general page-level Apply links, and native/ATS validation errors are reported after the click. A click alone is never submission confirmation.
- Single-field and segmented email verification codes are read back before the verification action is used. Segmented widgets are tried with auto-advance typing and then per-box entry; a code/input-count mismatch stops verification.
- If a required value cannot be selected or the workflow times out, the current tab stays open for inspection; the next application is not started unless the current submission is confirmed.

### Workable

- **Stale DOM References:** Workable is a Single Page Application (SPA) that aggressively re-renders form components, which can break automated typing. The agent works around this by using direct clipboard dispatch (`Ctrl+V` pasting) and querying fresh elements right before every paste. If that fails, it will present a numbered list of answers for you to paste manually.

### Generic Quirks (React-Select)

- Dropdowns powered by `react-select` (common across Greenhouse, Ashby, and Lever) recreate their DOM on every keystroke. The agent types character-by-character with short delays and re-snapshots the DOM to pick up changes instead of caching broken references.
- For massive native dropdowns (like countries or universities with 1,000+ options), the agent won't dump them all into its context. Instead, it selects them directly by value or visible label, or asks you for the correct label.

---

## 2. The Knock-Out Pre-Scan

Before it drafts a single answer, the agent scans the form for **knock-out questions**. These are questions designed to immediately disqualify you if your answers don't match the employer's hard requirements.

The agent checks your `config/profile.yml` against questions regarding:
- Minimum years of experience
- Degree or education requirements
- Work authorization or visa sponsorship needs
- Salary floors or expectations

**How the warning works:**
If the agent detects a potential mismatch (for example, you need visa sponsorship and the form automatically filters out applicants who do), it halts the generation process immediately and shows you a warning:

> `⚠️ KNOCK-OUT WARNING: The form asks "[question text]". Based on your profile/CV, answering "[profile answer]" may trigger immediate automatic rejection by the ATS. How would you like to answer this, or do you want to skip applying?`

This saves you from spending time tailoring responses for a job that the ATS will automatically reject.

---

## 3. Troubleshooting

- **Agent hangs or crashes mid-form:** This usually happens when an ATS updates its React DOM unexpectedly or pops a hidden captcha. When this happens, look at the agent's output—it always prints a complete list of generated answers. You can easily copy and paste the remaining answers manually.
- **Form changes:** If you notice the form on screen is for a different role than the one evaluated in your report, the agent will detect it and ask if you want to adapt the responses to the new title or stop and re-evaluate.
- **Multiple roles in one session:** Running batch applies? Always run a **Liveness sweep** (`node check-liveness.mjs --file data/pipeline.md`) first to drop dead postings from your pipeline so you never waste time opening an expired role tab.
