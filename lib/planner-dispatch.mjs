// Native-only form-planning dispatch. There is deliberately NO cross-vendor
// or OpenRouter tier: when no native planner path exists, the caller gets a
// PlannerUnavailableError and continues with profile-backed answers only —
// answers are never guessed or invented.
//
// Priority: (1) CAREER_OPS_NATIVE_SUBAGENT=1 — the host agent services the
// request with its own native sub-agent via the chat-agent handoff;
// (2) a headless spawn of the DETECTED active agent CLI (never a different
// vendor's CLI); (3) PlannerUnavailableError.
import { requestChatAgentFormPlan } from './chat-agent-form-plan.mjs';
import { callActiveAgentFormPlanner } from './active-agent-form-planner.mjs';

export class PlannerUnavailableError extends Error {
  constructor(message = 'No native sub-agent planning path is available.') {
    super(message);
    this.name = 'PlannerUnavailableError';
  }
}

let activeAgentDisabled = false;

export async function callFormPlanner(systemPrompt, userMessage, options = {}) {
  const validate = response => !options.validateResponse || options.validateResponse(response.content);
  if (process.env.CAREER_OPS_NATIVE_SUBAGENT === '1') {
    const response = await requestChatAgentFormPlan(systemPrompt, userMessage, {
      validateResponse: content => !options.validateResponse || options.validateResponse(content),
    });
    if (!validate(response)) throw new Error('The native agent returned an invalid answer plan.');
    return response;
  }
  if (!activeAgentDisabled) {
    try {
      const response = await callActiveAgentFormPlanner(systemPrompt, userMessage);
      if (!validate(response)) throw new Error('The active-agent planner returned an invalid answer plan.');
      return response;
    } catch (error) {
      activeAgentDisabled = true;
      console.warn(`  ↪ Active agent CLI unavailable for form planning (${error.message}); continuing with profile-backed answers.`);
      throw new PlannerUnavailableError(error.message);
    }
  }
  throw new PlannerUnavailableError();
}
