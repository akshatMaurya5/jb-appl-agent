// Two-stage verify loop: after each fill pass, re-check mandatory coverage
// from a FRESH DOM snapshot — fields revealed by earlier answers get filled
// in the next pass. The caller must only submit/advance at 100% mandatory
// coverage. The fill/unresolved functions are injected so autofill.mjs keeps
// owning its Playwright page (no circular import back into the driver).

export const DEFAULT_VERIFY_ROUNDS = 3;

export function verifyRounds(profile = {}) {
  const fromProfile = profile?.raw?.autofill?.watchdog?.verify_rounds;
  if (Number.isInteger(fromProfile) && fromProfile > 0) return fromProfile;
  const fromEnv = Number(process.env.CAREER_OPS_VERIFY_ROUNDS);
  if (Number.isInteger(fromEnv) && fromEnv > 0) return fromEnv;
  return DEFAULT_VERIFY_ROUNDS;
}

export async function mandatoryCoverageLoop({ fill, unresolved, rounds = DEFAULT_VERIFY_ROUNDS, log = console }) {
  let coverage = { ok: false, roundsUsed: 0, unresolved: [] };
  for (let round = 1; round <= rounds; round++) {
    await fill(round);
    const missing = (await unresolved()).filter(Boolean);
    coverage = { ok: missing.length === 0, roundsUsed: round, unresolved: missing };
    if (coverage.ok) return coverage;
    log.warn(`  ⚠ Verify round ${round}/${rounds}: mandatory fields still unanswered: ${missing.join('; ')}`);
  }
  return coverage;
}
