import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { requestChatAgentFormPlan } from '../openrouter-runner.mjs';

const validPlan = JSON.stringify({
  answers: [{ key: 'text:0', answer: 'Supported answer', supported: true }],
  choices: [{ key: 'native:0', option_index: 1, supported: true, confidence: 0.9 }],
});

test('hands form inventory to the chat agent and accepts its response file', async () => {
  let handoffLine = '';
  const result = await requestChatAgentFormPlan('Planner rules', '{"trusted":"facts"}', {
    timeoutMs: 1000,
    pollIntervalMs: 5,
    validateResponse: content => {
      const data = JSON.parse(content);
      return Array.isArray(data.answers) && Array.isArray(data.choices);
    },
    onHandoff: line => {
      handoffLine = line;
      const handoff = JSON.parse(line.slice('CAREER_OPS_CHAT_AGENT_FORM_PLAN '.length));
      const request = JSON.parse(readFileSync(handoff.requestPath, 'utf8'));
      assert.equal(request.protocol, 'career-ops-chat-form-plan-v1');
      assert.equal(request.systemPrompt, 'Planner rules');
      assert.equal(request.userMessage, '{"trusted":"facts"}');
      assert.equal(request.responsePath, handoff.responsePath);
      writeFileSync(handoff.responsePath, validPlan, { mode: 0o600, flag: 'wx' });
    },
  });

  assert.match(handoffLine, /^CAREER_OPS_CHAT_AGENT_FORM_PLAN /);
  assert.equal(result.model, 'chat-agent-handoff');
  assert.deepEqual(JSON.parse(result.content), JSON.parse(validPlan));
  const handoff = JSON.parse(handoffLine.slice('CAREER_OPS_CHAT_AGENT_FORM_PLAN '.length));
  assert.equal(existsSync(handoff.requestPath), false, 'temporary request directory was not cleaned up');
});

test('rejects malformed chat-agent plans instead of returning them', async () => {
  await assert.rejects(
    requestChatAgentFormPlan('rules', 'form', {
      timeoutMs: 1000,
      pollIntervalMs: 5,
      validateResponse: content => {
        const data = JSON.parse(content);
        return Array.isArray(data.answers) && Array.isArray(data.choices);
      },
      onHandoff: line => {
        const handoff = JSON.parse(line.slice('CAREER_OPS_CHAT_AGENT_FORM_PLAN '.length));
        writeFileSync(handoff.responsePath, '{"answers":[]}', { mode: 0o600, flag: 'wx' });
      },
    }),
    error => error.code === 'CAREER_OPS_CHAT_PLAN_INVALID',
  );
});

test('times out clearly when no chat-agent response is provided', async () => {
  let handoffLine = '';
  await assert.rejects(
    requestChatAgentFormPlan('rules', 'form', {
      timeoutMs: 10,
      pollIntervalMs: 1,
      onHandoff: line => { handoffLine = line; },
    }),
    error => error.code === 'CAREER_OPS_CHAT_PLAN_TIMEOUT',
  );
  const handoff = JSON.parse(handoffLine.slice('CAREER_OPS_CHAT_AGENT_FORM_PLAN '.length));
  assert.equal(existsSync(handoff.requestPath), false, 'temporary request directory was not cleaned up');
});
