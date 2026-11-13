import { generateText, stepCountIs } from 'ai';
import { createGateway } from '@ai-sdk/gateway';
import { anthropic } from '@ai-sdk/anthropic';
import { openai } from '@ai-sdk/openai';
import { google } from '@ai-sdk/google';
import { HttpError, envInt } from './util.js';
import { gatewayFailure } from './gateway-errors.js';
import { searchLocation } from './search-location.js';

export const gatewayEnabled = () => !!process.env.AI_GATEWAY_API_KEY;
export const gatewayModels = () => ({
  claude: process.env.AI_GATEWAY_CLAUDE_MODEL || 'anthropic/claude-sonnet-5.5',
  judge: process.env.AI_GATEWAY_JUDGE_MODEL || 'anthropic/claude-sonnet-5.5',
  openai: process.env.AI_GATEWAY_OPENAI_MODEL || 'openai/gpt-6-astra',
  gemini: process.env.AI_GATEWAY_GEMINI_MODEL || 'google/gemini-3.6-flash',
});

export function searchTools(engine) {
  if (engine === 'claude') return { web_search: anthropic.tools.webSearch_20250305({
    maxUses: envInt('WEB_SEARCH_MAX_USES', 3), userLocation: searchLocation(engine),
  }) };
  if (engine === 'openai') return { web_search: openai.tools.webSearch({ userLocation: searchLocation(engine) }) };
  if (engine === 'gemini') return { google_search: google.tools.googleSearch({}) };
  throw new HttpError(400, 'bad_engine', 'AI không được hỗ trợ.');
}

export function normalizeGateway(result) {
  const sources = new Map(), queries = new Set();
  for (const step of result.steps || [result]) {
    for (const s of step.sources || []) {
      if (s.sourceType === 'url' && /^https?:\/\//i.test(s.url)) {
        sources.set(s.url, { url: s.url, title: String(s.title || '').slice(0, 200), cited: true });
      }
    }
    for (const call of step.toolCalls || []) {
      if (typeof call.input?.query === 'string') queries.add(call.input.query.slice(0, 200));
    }
    const grounding = step.providerMetadata?.google?.groundingMetadata;
    for (const q of grounding?.webSearchQueries || []) queries.add(String(q).slice(0, 200));
    for (const tr of step.toolResults || []) {
      const action = tr.output?.action;
      if (typeof action?.query === 'string') queries.add(action.query.slice(0, 200));
      for (const q of action?.queries || []) queries.add(String(q).slice(0, 200));
    }
  }
  const u = result.totalUsage || result.usage || {};
  return { text: String(result.text || '').trim(), sources: [...sources.values()], queries: [...queries],
    truncated: result.finishReason === 'length',
    usage: { in: u.inputTokens || 0, out: u.outputTokens || 0, searches: queries.size } };
}

export async function askGateway(engine, { prompt, system, web = false, maxTokens = 1500, model, deadline }, generate = generateText) {
  if (!gatewayEnabled()) throw new HttpError(503, 'not_configured', 'Chưa cấu hình AI_GATEWAY_API_KEY.');
  const started = Date.now();
  const gateway = createGateway({ apiKey: process.env.AI_GATEWAY_API_KEY });
  const modelId = model || gatewayModels()[engine];
  try {
    const result = await generate({
      model: gateway(modelId), prompt, ...(system ? { system } : {}),
      maxOutputTokens: maxTokens, maxRetries: 1,
      abortSignal: AbortSignal.timeout(Math.max(1, (deadline || started + 100_000) - Date.now())),
      ...(web ? { tools: searchTools(engine), stopWhen: stepCountIs(3) } : {}),
      ...(engine === 'openai' ? { providerOptions: { openai: {
        store: false, reasoningEffort: process.env.OPENAI_REASONING_EFFORT || 'low',
      } } } : {}),
    });
    const out = normalizeGateway(result);
    if (!out.text) throw new HttpError(502, 'empty_response', 'AI Gateway không trả về nội dung.');
    return { engine, model: modelId, ms: Date.now() - started, ...out };
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw gatewayFailure(e, { engine, model: modelId, prompt, system });
  }
}
