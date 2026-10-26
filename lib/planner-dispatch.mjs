// planner-dispatch.mjs — the sub-agent tier: which transport answers an
// unanswered form question, and what happens when its first answer is unusable.
//
// WHY THIS FILE WAS REWRITTEN
// ---------------------------
// Four independent defects meant that, in practice, the sub-agent never ran:
//
// 1. `maxAttempts` was accepted and then ignored. `autofill.mjs` passed
//    `{maxAttempts: 6}` and the dispatcher called the CLI exactly once. A model
//    that answered with prose instead of JSON therefore lost the field
//    permanently, because (2) also marked it as attempted.
// 2. One CLI failure set a module-level `activeAgentDisabled = true` for the
//    whole process. The FIRST timeout killed planning for every later job in
//    the run, and the only trace was one warn line.
// 3. The chat-agent handoff was preferred whenever CAREER_OPS_NATIVE_SUBAGENT=1
//    and it BLOCKS for 180s waiting for a human-facing chat agent to write a
//    file. In a background runner nobody is watching, so that is three minutes
//    of a six-minute job budget spent waiting for a file that will never appear.
//    It is now opt-in (CAREER_OPS_CHAT_HANDOFF=1) and bounded by the planner
//    budget, and a non-blocking queue is available for unattended runs.
// 4. There was no feedback retry: a rejected answer was never sent back with
//    the reason, so even when a retry happened the model had no chance to fix
//    what it got wrong.
//
// WHAT THE LADDER IS NOW
// ----------------------
//   transport 1: the active agent CLI (lib/active-agent-form-planner.mjs)
//   transport 2: the chat-agent handoff, ONLY when explicitly opted in
//   transport 3: PlannerUnavailableError, carrying every attempt's reason
//
// Each transport gets `maxAttempts` tries (default 3). A try that produces an
// INVALID answer is retried with an explicit correction message appended, which
// is the only retry that can actually help: the transport worked, the answer
// was wrong. A try that fails to RUN is retried once after a short backoff and
// then the next transport takes over. Nothing latches a failure for the rest of
// the process.
import { requestChatAgentFormPlan } from './chat-agent-form-plan.mjs';
import { callActiveAgentFormPlanner, plannerAvailability } from './active-agent-form-planner.mjs';

// Re-exported so a caller has one place to ask "which transport answers, and is
// anything installed at all?" — autofill.mjs uses it to explain a planning
// failure instead of printing an opaque message.
export { plannerAvailability };

export class PlannerUnavailableError extends Error {
  constructor(message = 'No native sub-agent planning path is available.', details = {}) {
    super(message);
    this.name = 'PlannerUnavailableError';
    this.attempts = details.attempts || [];
    this.availability = details.availability || null;
  }
}

const DEFAULT_MAX_ATTEMPTS = 3;
// A transport that cannot even spawn gets one quick retry (flaky PATH, busy
// binary) and then the dispatcher moves on rather than burning the job budget.
const TRANSPORT_RETRY_DELAY_MS = 1_500;

// Per-process counters, for diagnostics only. They NEVER gate a later call:
// a failure is local to the call that saw it.
const stats = { calls: 0, attempts: 0, invalid: 0, transportErrors: 0, successes: 0, byVia: {} };

export function plannerStats() {
  return { ...stats, byVia: { ...stats.byVia } };
}

/** Test/diagnostic hook. */
export function resetPlannerStats() {
  stats.calls = 0; stats.attempts = 0; stats.invalid = 0; stats.transportErrors = 0; stats.successes = 0; stats.byVia = {};
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function attemptCount(options) {
  const explicit = Number(options.maxAttempts);
  if (Number.isFinite(explicit) && explicit > 0) return Math.floor(explicit);
  const env = Number(process.env.CAREER_OPS_PLANNER_MAX_ATTEMPTS);
  if (Number.isFinite(env) && env > 0) return Math.floor(env);
  return DEFAULT_MAX_ATTEMPTS;
}

/**
 * Why an answer was rejected, in words a model can act on.
 *
 * `validateResponse` is a boolean gate, so the reason has to come from the
 * shape of the response: not JSON, no answers/choices arrays, or nothing
 * supported. Guessing wrong here is harmless — the retry message says "the plan
 * was rejected", and the schema is restated either way.
 */
function rejectionFeedback(content) {
  const text = String(content || '');
  const json = text.match(/\{[\s\S]*\}/)?.[0];
  if (!json) return 'Your previous reply contained no JSON object. Reply with ONLY the JSON object, no prose and no Markdown fences.';
  try {
    const data = JSON.parse(json);
    if (!Array.isArray(data.answers) || !Array.isArray(data.choices)) {
      return 'Your previous reply was missing the "answers" and/or "choices" arrays. Both must always be present, even when empty.';
    }
    return 'Your previous reply parsed but was rejected by the response validator. Follow the required schema exactly: {"answers":[{"key":"text:0","answer":"...","supported":true}],"choices":[{"key":"native:0","option_index":0,"supported":true,"confidence":0.95}]}.';
  } catch {
    return 'Your previous reply was not valid JSON. Reply with ONLY the JSON object described in the schema.';
  }
}

function withFeedback(systemPrompt, userMessage, feedback) {
  // The correction goes FIRST in the system prompt: a model that ignored the
  // schema once tends to ignore a trailing reminder too.
  const corrective = `CORRECTION — a previous attempt was rejected: ${feedback}`;
  return {
    systemPrompt: `${corrective}\n\n${systemPrompt}`,
    userMessage,
  };
}

/**
 * Ask for an answer plan.
 *
 * Returns `{ content, model, cli?, attempts }` on success. Throws
 * `PlannerUnavailableError` when every transport and attempt failed — the
 * caller decides whether to continue with profile-backed answers (it always
 * should) and the ledger records `plannerAvailable: false`.
 */
export async function callFormPlanner(systemPrompt, userMessage, options = {}) {
  stats.calls++;
  const validate = response => {
    if (!options.validateResponse) return true;
    try {
      return Boolean(options.validateResponse(response?.content));
    } catch {
      return false;
    }
  };
  const attemptsLog = [];
  const attemptsAllowed = attemptCount(options);
  const profileCli = options.profileCli || process.env.CAREER_OPS_PLANNER_CLI_PROFILE || '';

  const transports = [];
  // Transport 2 is opt-in. CAREER_OPS_NATIVE_SUBAGENT is still honored so an
  // existing wrapper that sets it keeps working, but it no longer forces the
  // blocking path on its own.
  if (process.env.CAREER_OPS_CHAT_HANDOFF === '1' || process.env.CAREER_OPS_NATIVE_SUBAGENT === '1') {
    transports.push({ name: 'chat-handoff', run: async () => requestChatAgentFormPlan(systemPrompt, userMessage, {
      validateResponse: content => !options.validateResponse || Boolean(options.validateResponse(content)),
      timeoutMs: options.timeoutMs,
    }) });
  }
  transports.push({ name: 'active-agent-cli', run: () => callActiveAgentFormPlanner(systemPrompt, userMessage, {
    timeoutMs: options.timeoutMs,
    profileCli,
  }) });

  for (const transport of transports) {
    let attempt = 0;
    let feedback = '';
    while (attempt < attemptsAllowed) {
      attempt++;
      stats.attempts++;
      let prompt = { systemPrompt, userMessage };
      if (feedback) prompt = withFeedback(systemPrompt, userMessage, feedback);
      try {
        const response = await transport.run(prompt.systemPrompt, prompt.userMessage);
        if (validate(response)) {
          stats.successes++;
          const via = `${transport.name}:${response.cli || response.model || 'unknown'}`;
          stats.byVia[via] = (stats.byVia[via] || 0) + 1;
          attemptsLog.push({ transport: transport.name, attempt, outcome: 'ok' });
          return { ...response, attempts: attemptsLog, via };
        }
        // Transport worked, answer was unusable: retry with the reason.
        stats.invalid++;
        feedback = rejectionFeedback(response?.content);
        attemptsLog.push({ transport: transport.name, attempt, outcome: 'invalid', feedback });
        console.warn(`  ⚠ ${transport.name} returned an unusable answer plan (attempt ${attempt}/${attemptsAllowed}); retrying with a correction.`);
        continue;
      } catch (error) {
        stats.transportErrors++;
        attemptsLog.push({ transport: transport.name, attempt, outcome: 'error', error: error.message });
        // A spawn/transport failure is not fixed by asking again in the same
        // way, but one retry covers a transient PATH/lock problem.
        if (attempt === 1) {
          await delay(TRANSPORT_RETRY_DELAY_MS);
          continue;
        }
        console.warn(`  ↪ ${transport.name} could not answer (${error.message}); trying the next planning path.`);
        break;
      }
    }
  }

  const availability = plannerAvailability({ profileCli });
  throw new PlannerUnavailableError(
    'No form-planning path produced a valid answer plan.',
    { attempts: attemptsLog, availability },
  );
}
