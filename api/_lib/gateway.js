import { generateText, stepCountIs } from 'ai';
import { createGateway, gateway as gatewayProvider } from '@ai-sdk/gateway';
import { anthropic } from '@ai-sdk/anthropic';
import { openai } from '@ai-sdk/openai';
import { google } from '@ai-sdk/google';
import { xai } from '@ai-sdk/xai';
import { HttpError, envInt } from './util.js';
import { gatewayFailure } from './gateway-errors.js';
import { searchLocation } from './search-location.js';

export const gatewayEnabled = () => !!process.env.AI_GATEWAY_API_KEY;
export const gatewayModels = () => ({
  claude: process.env.AI_GATEWAY_CLAUDE_MODEL || 'anthropic/claude-sonnet-5.5',
  judge: process.env.AI_GATEWAY_JUDGE_MODEL || 'anthropic/claude-sonnet-5.5',
  openai: process.env.AI_GATEWAY_OPENAI_MODEL || 'openai/gpt-6-astra',
  gemini: process.env.AI_GATEWAY_GEMINI_MODEL || 'google/gemini-3.6-flash',
  grok: process.env.AI_GATEWAY_GROK_MODEL || 'spacexai/grok-4.20-non-reasoning',
  deepseek: process.env.AI_GATEWAY_DEEPSEEK_MODEL || 'deepseek/deepseek-v4.1-flash',
});
// Grok và DeepSeek chỉ chạy qua AI Gateway (không có cấu hình khóa trực tiếp).
export const GATEWAY_ONLY = ['grok', 'deepseek'];

export function searchTools(engine) {
  if (engine === 'claude') return { web_search: anthropic.tools.webSearch_20250305({
    maxUses: envInt('WEB_SEARCH_MAX_USES', 3), userLocation: searchLocation(engine),
  }) };
  if (engine === 'openai') return { web_search: openai.tools.webSearch({ userLocation: searchLocation(engine) }) };
  if (engine === 'gemini') return { google_search: google.tools.googleSearch({}) };
  // Grok dùng tìm kiếm web gốc của SpaceXAI, giống cách ứng dụng Grok trả lời người dùng.
  if (engine === 'grok') return { web_search: xai.tools.webSearch({}) };
  // DeepSeek không có tìm kiếm gốc qua API; dùng DeepSeek Search của AI Gateway (cùng hệ DeepSeek).
  if (engine === 'deepseek') return { deepseek_search: gatewayProvider.tools.deepseekSearch({ count: envInt('DEEPSEEK_SEARCH_COUNT', 8) }) };
  throw new HttpError(400, 'bad_engine', 'AI không được hỗ trợ.');
}

const hostOf = u => { try { return new URL(u).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; } };

export function normalizeGateway(result) {
  const sources = new Map(), queries = new Set(), retrieved = new Map();
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
      // Công cụ tìm kiếm của Gateway (DeepSeek Search) trả kết quả trong tool result, không qua sources.
      const items = Array.isArray(tr.output?.results) ? tr.output.results : Array.isArray(tr.output) ? tr.output : [];
      for (const it of items.slice(0, 30)) {
        const url = typeof it?.url === 'string' ? it.url : '';
        if (/^https?:\/\//i.test(url) && !retrieved.has(url)) retrieved.set(url, { url, title: String(it.title || '').slice(0, 200) });
      }
    }
  }
  const text = String(result.text || '').trim(), lower = text.toLowerCase();
  // Nguồn chỉ được tìm thấy (không do nhà cung cấp gắn trích dẫn) coi là trích dẫn khi câu trả lời nhắc tới tên miền.
  for (const r of retrieved.values()) if (!sources.has(r.url)) {
    const host = hostOf(r.url);
    sources.set(r.url, { ...r, cited: !!host && (lower.includes(host) || lower.includes(r.url.toLowerCase())) });
  }
  const u = result.totalUsage || result.usage || {};
  return { text, sources: [...sources.values()], queries: [...queries],
    truncated: result.finishReason === 'length',
    usage: { in: u.inputTokens || 0, out: u.outputTokens || 0, searches: queries.size } };
}

export async function askGateway(engine, { prompt, system, web = false, maxTokens = 1500, model, deadline, maxRetries = 1 }, generate = generateText) {
  if (!gatewayEnabled()) throw new HttpError(503, 'not_configured', 'Chưa cấu hình AI_GATEWAY_API_KEY.');
  const started = Date.now();
  const gateway = createGateway({ apiKey: process.env.AI_GATEWAY_API_KEY });
  const modelId = model || gatewayModels()[engine];
  try {
    const result = await generate({
      model: gateway(modelId), prompt, ...(system ? { system } : {}),
      maxOutputTokens: maxTokens, maxRetries,
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
