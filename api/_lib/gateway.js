import { generateText, stepCountIs } from 'ai';
import { createGateway } from '@ai-sdk/gateway';
import { anthropic } from '@ai-sdk/anthropic';
import { openai } from '@ai-sdk/openai';
import { google } from '@ai-sdk/google';
import { HttpError, envInt } from './util.js';

export const gatewayEnabled = () => !!process.env.AI_GATEWAY_API_KEY;
export const gatewayModels = () => ({
  claude: process.env.AI_GATEWAY_CLAUDE_MODEL || 'anthropic/claude-sonnet-5.5',
  judge: process.env.AI_GATEWAY_JUDGE_MODEL || 'anthropic/claude-sonnet-5.5',
  openai: process.env.AI_GATEWAY_OPENAI_MODEL || 'openai/gpt-6-astra',
  gemini: process.env.AI_GATEWAY_GEMINI_MODEL || 'google/gemini-3.6-flash',
});

export function searchTools(engine) {
  const location = {
    country: process.env.SEARCH_COUNTRY || 'VN',
    city: process.env.SEARCH_CITY || 'Hanoi',
    region: process.env.SEARCH_REGION || 'Hanoi',
    timezone: process.env.SEARCH_TIMEZONE || 'Asia/Ho_Chi_Minh',
  };
  if (engine === 'claude') return { web_search: anthropic.tools.webSearch_20250305({
    maxUses: envInt('WEB_SEARCH_MAX_USES', 3), userLocation: { type: 'approximate', ...location },
  }) };
  if (engine === 'openai') return { web_search: openai.tools.webSearch({ userLocation: { type: 'approximate', ...location } }) };
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
    const status = e.statusCode || e.cause?.statusCode;
    if (status === 401 || status === 403) throw new HttpError(502, 'auth_failed', 'AI Gateway: key không hợp lệ hoặc chưa được cấp quyền.');
    if (status === 402) throw new HttpError(502, 'insufficient_credit', 'AI Gateway: không đủ số dư. Kiểm tra credit trên Vercel.');
    if (status === 429) throw new HttpError(502, 'rate_limited', 'AI Gateway: vượt giới hạn tốc độ hoặc hạn mức.');
    if (status === 404) throw new HttpError(502, 'model_not_found', 'AI Gateway: không tìm thấy model. Kiểm tra biến AI_GATEWAY_*_MODEL.');
    if (e.name === 'TimeoutError' || e.name === 'AbortError') throw new HttpError(504, 'timeout', 'AI Gateway: hết thời gian chờ.');
    throw new HttpError(502, 'provider_error', 'AI Gateway: không hoàn tất được yêu cầu. Kiểm tra model và nhật ký Gateway trên Vercel.');
  }
}
