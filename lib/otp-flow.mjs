// OTP end-to-end with retries: poll mail for the code, enter it, activate
// verification (cap 2 attempts with a FRESH code on retry), then post-OTP
// resubmit follow-ups. Everything page-related is injected so autofill.mjs
// keeps owning its Playwright page; this module only owns the flow.
//
// Statuses: 'entered' (code entered + verify activated; caller keeps polling
// for confirmation) · 'no-code-inputs' (no OTP widget on the page; caller
// keeps its normal confirmation loop) · 'no-code' (code never arrived within
// budget — caller records the failure and moves on).

const VERIFY_ATTEMPTS_CAP = 2;
const POST_OTP_FOLLOWUPS = 3;

async function clearInputs(inputs) {
  for (const input of inputs) await input.fill('').catch(() => {});
}

export async function runOtpFlow({
  detectInputs, // async () => Locator[] — re-run because OTP widgets re-render
  fetchCode, // async (sinceEpoch, company) => { code, source } | null (already polls internally)
  enterCode, // async (inputs, code) => boolean
  clickVerify, // async (inputs) => boolean — activate the verify action
  followUpSubmit, // async () => boolean — click a visible enabled submit button if present
  isConfirmed, // async () => boolean
  company = '',
  submittedAt,
  otpPollSeconds = 120,
  confirmDeadlineMs = Date.now() + 300000,
  sleepMs = 3000,
} = {}) {
  const sleep = () => new Promise(resolve => setTimeout(resolve, sleepMs));
  const sinceEpoch = submittedAt ?? Math.floor(Date.now() / 1000);
  let codeResult = await fetchCode(sinceEpoch, company);
  if (!codeResult?.code) {
    // The email may take longer than one poll window, or the first submit
    // may not have registered: re-click submit (the form is still filled,
    // which yields a fresh email timestamp) and poll once more, bounded by
    // the confirmation deadline so the OTP wait cannot blow the job budget.
    if (Date.now() + otpPollSeconds * 1000 > confirmDeadlineMs) return { status: 'no-code' };
    const resubmitted = await followUpSubmit();
    if (!resubmitted) return { status: 'no-code' };
    codeResult = await fetchCode(Math.floor(Date.now() / 1000), company);
    if (!codeResult?.code) return { status: 'no-code' };
  }

  for (let attempt = 1; attempt <= VERIFY_ATTEMPTS_CAP; attempt++) {
    let inputs = await detectInputs();
    if (!inputs.length) return { status: 'no-code-inputs' };
    let entered = await enterCode(inputs, codeResult.code);
    if (!entered) {
      // OTP widgets can re-render between detection and entry; re-detect once.
      const reDetected = await detectInputs();
      if (reDetected.length && reDetected !== inputs) {
        inputs = reDetected;
        entered = await enterCode(inputs, codeResult.code);
      }
    }
    if (!entered) return { status: 'no-code-inputs' };

    const activated = await clickVerify(inputs);
    if (activated) {
      console.log(`  🔐 Verification code entered (source: ${codeResult.source || 'mail'}).`);
      // Post-OTP resubmit: some ATS flows need one more submit click after
      // verification before they confirm. If a submit action is visible and
      // enabled but no confirmation yet, follow up a bounded number of times.
      await sleep();
      for (let followUp = 0; followUp < POST_OTP_FOLLOWUPS; followUp++) {
        if (await isConfirmed()) break;
        if (!(await followUpSubmit())) break;
        await sleep();
      }
      return { status: 'entered', code: codeResult.code, source: codeResult.source, attempt };
    }

    if (attempt < VERIFY_ATTEMPTS_CAP) {
      // Retry with a FRESH code: clear the boxes, re-poll mail since now.
      console.warn('  ⚠ Verification action did not activate; clearing the code boxes and re-fetching a fresh code.');
      await clearInputs(inputs);
      codeResult = await fetchCode(Math.floor(Date.now() / 1000), company);
      if (!codeResult?.code) return { status: 'no-code' };
    }
  }
  return { status: 'no-code-inputs' };
}
