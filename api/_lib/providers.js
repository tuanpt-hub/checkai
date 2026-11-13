import { HttpError, httpJSON, envInt } from './util.js';
import { gatewayEnabled, gatewayModels, askGateway } from './gateway.js';
import { gatewayFailure } from './gateway-errors.js';
import { searchLocation } from './search-location.js';
import { claudeThinking, claudeOutputError } from './claude-output.js';

/* ---------- cấu hình ---------- */
export const MODELS = () => gatewayEnabled() ? gatewayModels() : ({
  claude: process.env.ANTHROPIC_PROBE_MODEL || process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5',
  judge: process.env.ANTHROPIC_JUDGE_MODEL || process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5',
  openai: process.env.OPENAI_MODEL || 'gpt-6-astra',
  gemini: process.env.GEMINI_MODEL || 'gemini-3.6-flash',
});
export const configured = () => ({
  claude: gatewayEnabled() || !!process.env.ANTHROPIC_API_KEY,
  openai: gatewayEnabled() || !!process.env.OPENAI_API_KEY,
  gemini: gatewayEnabled() || !!process.env.GEMINI_API_KEY,
});

const baseUrl = (envName, def) => (process.env[envName] || def).replace(/\/$/, '');
const loc = () => ({
  country: process.env.SEARCH_COUNTRY || 'VN',
  city: process.env.SEARCH_CITY || 'Hanoi',
  region: process.env.SEARCH_REGION || 'Hanoi',
  timezone: process.env.SEARCH_TIMEZONE || 'Asia/Ho_Chi_Minh',
});
export const PROBE_SYSTEM =
  process.env.PROBE_SYSTEM || 'Trả lời bằng tiếng Việt, ngắn gọn (tối đa khoảng 220 từ).';

function needKey(name, label) {
  const k = process.env[name];
  if (!k) throw new HttpError(503, 'not_configured', `Chưa cấu hình ${name} (${label}).`);
  return k;
}

function mapErr(label, r) {
  const msg = String((r.json && (r.json.error?.message || r.json.message)) || r.text || '').replace(/\s+/g, ' ').slice(0, 280);
  const s = r.status;
  if (s === 401 || s === 403) return new HttpError(502, 'auth_failed', `${label}: khóa API không hợp lệ hoặc chưa được cấp quyền. ${msg}`);
  if (s === 404) return new HttpError(502, 'model_not_found', `${label}: không tìm thấy model hoặc tính năng đang dùng. ${msg}`);
  if (s === 429) return new HttpError(502, 'rate_limited', `${label}: vượt giới hạn tốc độ hoặc hạn mức. ${msg}`);
  if (s === 400) return new HttpError(502, 'bad_request', `${label}: yêu cầu bị từ chối. ${msg}`);
  return new HttpError(502, 'provider_error', `${label}: lỗi ${s}. ${msg}`);
}

function addSrc(map, url, title, cited) {
  if (!url || typeof url !== 'string' || !/^https?:\/\//i.test(url)) return;
  const prev = map.get(url);
  if (prev) { prev.cited = prev.cited || cited; if (!prev.title && title) prev.title = title; return; }
  map.set(url, { url, title: String(title || '').slice(0, 200), cited: !!cited });
}
const finish = (engine, model, t0, out) => {
  if (!out.text) throw new HttpError(502, 'empty_response', `${engine}: nhà cung cấp không trả về nội dung.`);
  return { engine, model, ms: Date.now() - t0, ...out };
};

/* ---------- Claude (Anthropic Messages API) ---------- */
export function parseAnthropic(blocks, sources = new Map(), queries = []) {
  let last = -1;
  blocks.forEach((b, i) => { if (b.type === 'web_search_tool_result') last = i; });
  blocks.forEach((b) => {
    if (b.type === 'server_tool_use' && b.input && b.input.query) queries.push(String(b.input.query).slice(0, 200));
    if (b.type === 'web_search_tool_result' && Array.isArray(b.content)) b.content.forEach((x) => addSrc(sources, x.url, x.title, false));
    if (b.type === 'text' && Array.isArray(b.citations)) b.citations.forEach((c) => addSrc(sources, c.url, c.title, true));
  });
  const after = blocks.filter((b, i) => b.type === 'text' && i > last);
  const use = after.length ? after : blocks.filter((b) => b.type === 'text');
  return { text: use.map((b) => b.text).join('').trim(), sources, queries };
}

export async function askClaude({ prompt, system, web = false, maxTokens = 1500, model, deadline, retries, maxRetries }) {
  const viaGateway = gatewayEnabled();
  const key = needKey(viaGateway ? 'AI_GATEWAY_API_KEY' : 'ANTHROPIC_API_KEY', 'Claude');
  // Native Messages preserves Anthropic search blocks, citations and pause_turn.
  const url = (viaGateway ? 'https://ai-gateway.vercel.sh' : baseUrl('ANTHROPIC_BASE_URL', 'https://api.anthropic.com')) + '/v1/messages';
  model = model || MODELS().claude;
  const t0 = Date.now();
  deadline = deadline || t0 + 100_000;
  const tool = {
    type: process.env.ANTHROPIC_WEB_SEARCH_TOOL || 'web_search_20250305',
    name: 'web_search',
    max_uses: envInt('WEB_SEARCH_MAX_USES', 3),
    user_location: searchLocation('claude'),
  };
  let messages = [{ role: 'user', content: prompt }];
  let all = [], lastMessage = null;
  let usage = { in: 0, out: 0, searches: 0 };
  for (let loop = 0; loop < 3; loop++) {
    if (Date.now() >= deadline) throw new HttpError(504, 'timeout', 'Claude: hết thời gian chờ.');
    const r = await httpJSON(url, {
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: { model, max_tokens: maxTokens, ...claudeThinking(model, web), messages, ...(system ? { system } : {}), ...(web ? { tools: [tool] } : {}) },
      deadline,
      timeoutMs: Math.max(1, Math.min(90000, (deadline || Date.now() + 90000) - Date.now())),
      retries: retries ?? (viaGateway ? 0 : 2),
    });
    if (r.status !== 200 || !r.json) {
      if (viaGateway) throw gatewayFailure(Object.assign(new Error(r.json?.error?.message || r.json?.message || 'Gateway Messages request failed'), {
        statusCode: r.status, type: r.json?.error?.type, generationId: r.json?.generationId,
      }), { engine: 'claude', model, prompt, system });
      throw mapErr('Claude', r);
    }
    const j = r.json;lastMessage = j;
    if (!Array.isArray(j.content) || j.content.some(b => !b || typeof b !== 'object' || Array.isArray(b))) throw claudeOutputError(j, [], model, 'invalid_provider_response');
    all = all.concat(j.content);
    usage.in += j.usage?.input_tokens || 0;
    usage.out += j.usage?.output_tokens || 0;
    usage.searches += j.usage?.server_tool_use?.web_search_requests || 0;
    if (j.stop_reason === 'pause_turn') {
      messages = [...messages, { role: 'assistant', content: j.content }];
      continue;
    }
    const p = parseAnthropic(all);
    if (!p.text) throw claudeOutputError(j, all, model);
    return finish('claude', model, t0, {
      text: p.text,
      sources: [...p.sources.values()],
      queries: p.queries,
      truncated: j.stop_reason === 'max_tokens',
      usage,
      ...(web ? { searchLocation: searchLocation('claude') } : {}),
    });
  }
  const p = parseAnthropic(all);
  if (!p.text) throw claudeOutputError(lastMessage, all, model);
  return finish('claude', model, t0, { text: p.text, sources: [...p.sources.values()], queries: p.queries, truncated: true, usage, ...(web ? { searchLocation: searchLocation('claude') } : {}) });
}

/* ---------- ChatGPT (OpenAI Responses API) ---------- */
export function parseOpenAI(output) {
  const sources = new Map();
  const queries = [];
  let text = '';
  for (const item of output || []) {
    if (item.type === 'web_search_call' && item.action) {
      if (item.action.query) queries.push(String(item.action.query).slice(0, 200));
      (item.action.queries || []).forEach((q) => queries.push(String(q).slice(0, 200)));
      (item.action.sources || []).forEach((s) => addSrc(sources, s.url, s.title, false));
    }
    if (item.type === 'message') {
      for (const c of item.content || []) {
        if (c.type === 'output_text') {
          text += c.text || '';
          (c.annotations || []).forEach((a) => {
            if (a.type === 'url_citation') addSrc(sources, a.url || (a.url_citation && a.url_citation.url), a.title || (a.url_citation && a.url_citation.title), true);
          });
        }
      }
    }
  }
  return { text: text.trim(), sources, queries };
}

export async function askOpenAI({ prompt, system, web = false, maxTokens = 4000, model, deadline, retries, maxRetries }) {
  if (gatewayEnabled()) return askGateway('openai', { prompt, system, web, maxTokens, model, deadline, maxRetries });
  const key = needKey('OPENAI_API_KEY', 'ChatGPT');
  const url = baseUrl('OPENAI_BASE_URL', 'https://api.openai.com') + '/v1/responses';
  const t0 = Date.now();
  const effort = process.env.OPENAI_REASONING_EFFORT === undefined ? 'low' : process.env.OPENAI_REASONING_EFFORT;
  const body = {
    model,
    input: prompt,
    max_output_tokens: envInt('OPENAI_MAX_OUTPUT_TOKENS', maxTokens),
    store: false,
    ...(system ? { instructions: system } : {}),
    ...(effort ? { reasoning: { effort } } : {}),
  };
  if (web) {
    body.tools = [{ type: 'web_search', user_location: { type: 'approximate', ...loc() } }];
    body.tool_choice = process.env.OPENAI_TOOL_CHOICE || 'auto';
    body.include = ['web_search_call.action.sources'];
  }
  const r = await httpJSON(url, { headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body, deadline, retries });
  if (r.status !== 200 || !r.json) throw mapErr('ChatGPT', r);
  const p = parseOpenAI(r.json.output);
  const u = r.json.usage || {};
  return finish('openai', model, t0, {
    text: p.text,
    sources: [...p.sources.values()],
    queries: p.queries,
    truncated: r.json.status === 'incomplete',
    usage: { in: u.input_tokens || 0, out: u.output_tokens || 0, searches: p.queries.length },
  });
}

/* ---------- Gemini (generateContent + Grounding with Google Search) ---------- */
export function parseGemini(json) {
  const cand = (json.candidates || [])[0] || {};
  const parts = (cand.content && cand.content.parts) || [];
  const text = parts.filter((p) => typeof p.text === 'string' && !p.thought).map((p) => p.text).join('').trim();
  const gm = cand.groundingMetadata || {};
  const sources = new Map();
  (gm.groundingChunks || []).forEach((c) => c.web && addSrc(sources, c.web.uri, c.web.title, true));
  return { text, sources, queries: (gm.webSearchQueries || []).map((q) => String(q).slice(0, 200)), finish: cand.finishReason };
}

export async function askGemini({ prompt, system, web = false, maxTokens = 4096, model, deadline, retries, maxRetries }) {
  if (gatewayEnabled()) return askGateway('gemini', { prompt, system, web, maxTokens, model, deadline, maxRetries });
  const key = needKey('GEMINI_API_KEY', 'Gemini');
  const url = `${baseUrl('GEMINI_BASE_URL', 'https://generativelanguage.googleapis.com')}/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const t0 = Date.now();
  const r = await httpJSON(url, {
    headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
    body: {
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
      ...(web ? { tools: [{ google_search: {} }] } : {}),
      generationConfig: { maxOutputTokens: envInt('GEMINI_MAX_OUTPUT_TOKENS', maxTokens) },
    },
    deadline,
    retries,
  });
  if (r.status !== 200 || !r.json) throw mapErr('Gemini', r);
  if (r.json.promptFeedback && r.json.promptFeedback.blockReason)
    throw new HttpError(502, 'blocked', `Gemini từ chối câu hỏi (${r.json.promptFeedback.blockReason}).`);
  const p = parseGemini(r.json);
  const u = r.json.usageMetadata || {};
  return finish('gemini', model, t0, {
    text: p.text,
    sources: [...p.sources.values()],
    queries: p.queries,
    truncated: p.finish === 'MAX_TOKENS',
    usage: { in: u.promptTokenCount || 0, out: u.candidatesTokenCount || 0, searches: p.queries.length },
  });
}

export async function ask(engine, opts) {
  const m = MODELS();
  if (engine === 'claude') return askClaude({ ...opts, model: opts.model || m.claude });
  if (engine === 'openai') return askOpenAI({ ...opts, model: opts.model || m.openai });
  if (engine === 'gemini') return askGemini({ ...opts, model: opts.model || m.gemini });
  throw new HttpError(400, 'bad_engine', 'AI không được hỗ trợ.');
}
