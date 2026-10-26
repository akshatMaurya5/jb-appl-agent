// Chat-agent form-plan handoff protocol + repo-root .env loader.
// Extracted from openrouter-runner.mjs verbatim (behavior parity) so the
// autofill pipeline no longer imports the OpenRouter runner.
//
// The handoff writes a request.json into a 0700 tmp dir and prints a
// CAREER_OPS_CHAT_AGENT_FORM_PLAN line for the host chat agent; the host
// spawns its OWN native subagent, writes response.json, and this caller
// polls for it until the deadline.
import fs from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const CHAT_PLAN_TIMEOUT_MS = 180_000;
const CHAT_PLAN_POLL_MS = 250;
const MAX_CHAT_PLAN_BYTES = 1_000_000;

// ---------------------------------------------------------------------------
// .env loader
// ---------------------------------------------------------------------------
// Lazy: only runs when called explicitly. Importing this module must NOT
// mutate process.env — a module-level loader leaked every .env key (including
// CAREER_OPS_CLI) into the importing process and broke later CLI-resolution
// tests. Resolves .env at the repository root (same file the original
// openrouter-runner.mjs loader read), not relative to lib/.
export function loadEnvFile() {
  const envPath = path.resolve(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const m = line.trim().match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].trim().replace(/^(['"])(.*?)\1$/, '$2');
    }
  }
}

export async function requestChatAgentFormPlan(systemPrompt, userMessage, {
  validateResponse = () => true,
  timeoutMs = CHAT_PLAN_TIMEOUT_MS,
  pollIntervalMs = CHAT_PLAN_POLL_MS,
  onHandoff = message => console.log(message),
} = {}) {
  const requestDir = fs.mkdtempSync(path.join(tmpdir(), 'career-ops-form-plan-'));
  fs.chmodSync(requestDir, 0o700);
  const requestPath = path.join(requestDir, 'request.json');
  const responsePath = path.join(requestDir, 'response.json');
  const request = {
    protocol: 'career-ops-chat-form-plan-v1',
    systemPrompt,
    userMessage,
    responsePath,
    responseFormat: {
      answers: [{ key: 'text:0', answer: 'supported text', supported: true }],
      choices: [{ key: 'native:0', option_index: 0, supported: true, confidence: 0.95 }],
    },
  };
  fs.writeFileSync(requestPath, JSON.stringify(request), { mode: 0o600, flag: 'wx' });

  const deadline = Date.now() + timeoutMs;
  try {
    onHandoff(`CAREER_OPS_CHAT_AGENT_FORM_PLAN ${JSON.stringify({
      protocol: request.protocol,
      requestPath,
      responsePath,
      instructions: 'Read requestPath, then use the current chat agent to make only truthful, profile/CV-supported ordinary answers. Write JSON in its responseFormat to responsePath. Do not answer sensitive, legal, eligibility, consent, or unsupported questions.',
    })}`);
    while (Date.now() < deadline) {
      if (fs.existsSync(responsePath)) {
        const response = fs.readFileSync(responsePath);
        if (response.length > MAX_CHAT_PLAN_BYTES) {
          const error = new Error('The chat-agent form plan exceeded the response size limit.');
          error.code = 'CAREER_OPS_CHAT_PLAN_INVALID';
          throw error;
        }
        const content = response.toString('utf8').trim();
        if (!content) {
          const error = new Error('The chat-agent form planner returned an empty response.');
          error.code = 'CAREER_OPS_CHAT_PLAN_INVALID';
          throw error;
        }
        let valid;
        try {
          valid = validateResponse(content);
        } catch (cause) {
          const error = new Error(`The chat-agent form planner returned an invalid answer plan: ${cause.message}`);
          error.code = 'CAREER_OPS_CHAT_PLAN_INVALID';
          throw error;
        }
        if (!valid) {
          const error = new Error('The chat-agent form planner returned an invalid answer plan.');
          error.code = 'CAREER_OPS_CHAT_PLAN_INVALID';
          throw error;
        }
        return { content, model: 'chat-agent-handoff' };
      }
      await delay(pollIntervalMs);
    }
    const error = new Error(`No chat-agent form plan was provided within ${Math.ceil(timeoutMs / 1000)} seconds.`);
    error.code = 'CAREER_OPS_CHAT_PLAN_TIMEOUT';
    throw error;
  } finally {
    fs.rmSync(requestDir, { recursive: true, force: true });
  }
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
