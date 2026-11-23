import assert from 'node:assert/strict';
import { askGateway } from '../api/_lib/gateway.js';
import { configured, MODELS, askClaude } from '../api/_lib/providers.js';

process.env.AI_GATEWAY_API_KEY = 'gateway-test-secret';
for (const k of ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'GEMINI_API_KEY']) delete process.env[k];
assert.deepEqual(configured(), { claude: true, openai: true, gemini: true, grok: true, deepseek: true });
assert.equal(MODELS().grok, 'spacexai/grok-4.20-non-reasoning'); assert.equal(MODELS().deepseek, 'deepseek/deepseek-v4.1-flash');
assert.equal(MODELS().claude, 'anthropic/claude-sonnet-5.5');
for (const [engine, tool] of [['claude', 'web_search'], ['openai', 'web_search'], ['gemini', 'google_search'], ['grok', 'web_search']]) {
  let options;
  const r = await askGateway(engine, { prompt: 'NetSpace?', web: true }, async o => {
    options = o;
    return { text: 'NetSpace là thương hiệu thử nghiệm.', finishReason: 'stop', totalUsage: { inputTokens: 12, outputTokens: 8 }, steps: [
      { sources: [{ sourceType: 'url', url: 'https://netspace.vn', title: 'NetSpace' }], toolCalls: [{ input: { query: 'NetSpace' } }] },
      { sources: [{ sourceType: 'url', url: 'https://netspace.vn', title: 'NetSpace' }], providerMetadata: { google: { groundingMetadata: { webSearchQueries: ['NetSpace Việt Nam'] } } } },
    ] };
  });
  assert.equal(options.model.modelId, MODELS()[engine]);
  assert.ok(options.tools[tool]); assert.ok(options.abortSignal);
  assert.equal(r.sources.length, 1); assert.deepEqual(r.queries, ['NetSpace', 'NetSpace Việt Nam']);
  assert.equal(r.usage.in, 12); assert.equal(r.truncated, false);
}
// DeepSeek: tìm kiếm qua DeepSeek Search của Gateway; nguồn nằm trong tool result.
{
  let options;
  const r = await askGateway('deepseek', { prompt: 'NetSpace?', web: true }, async o => {
    options = o;
    return { text: 'NetSpace (netspace.vn) là công ty công nghệ và truyền thông.', finishReason: 'stop', totalUsage: { inputTokens: 20, outputTokens: 10 }, steps: [
      { toolCalls: [{ toolName: 'deepseek_search', input: { query: 'NetSpace là ai' } }],
        toolResults: [{ toolName: 'deepseek_search', output: { results: [
          { url: 'https://netspace.vn/gioi-thieu', title: 'Giới thiệu NetSpace' },
          { url: 'https://example.org/bai-khac', title: 'Bài khác' },
          { url: 'javascript:alert(1)', title: 'bỏ qua' }] } }] },
    ] };
  });
  assert.equal(options.model.modelId, 'deepseek/deepseek-v4.1-flash');
  assert.ok(options.tools.deepseek_search, 'DeepSeek Search tool attached');
  assert.deepEqual(r.queries, ['NetSpace là ai']); assert.equal(r.usage.searches, 1);
  assert.equal(r.sources.length, 2, 'non-http result dropped');
  assert.equal(r.sources.find(s => s.url.includes('netspace.vn')).cited, true, 'domain mentioned in answer counts as cited');
  assert.equal(r.sources.find(s => s.url.includes('example.org')).cited, false);
}
await askGateway('claude', { prompt: 'Chấm điểm', model: 'anthropic/custom-judge', web: false }, async o => {
  assert.equal(o.model.modelId, 'anthropic/custom-judge'); assert.equal(o.tools, undefined);
  return { text: '[]', finishReason: 'length' };
});
for (const [statusCode, code] of [[401, 'auth_failed'], [402, 'insufficient_credit'], [429, 'rate_limited'], [404, 'model_not_found']]) {
  await assert.rejects(askGateway('claude', { prompt: 'test' }, async () => { throw Object.assign(new Error('gateway-test-secret'), { statusCode }); }), e => e.code === code && !e.message.includes('gateway-test-secret'));
}
await assert.rejects(askGateway('claude', { prompt: 'test' }, async () => ({ text: '' })), e => e.code === 'empty_response');
// Exercise real SDK serialization + HTTP through public provider entry points.
const originalFetch = globalThis.fetch;
let requests = 0;
globalThis.fetch = async (url, init) => {
  requests++;
  assert.equal(String(url), 'https://ai-gateway.vercel.sh/v1/messages');
  assert.match(JSON.stringify(init.headers), /gateway-test-secret/);
  const body = JSON.parse(init.body);
  assert.equal(body.messages.at(-1).content, 'Judge via gateway');
  return new Response(JSON.stringify({ content: [{ type: 'text', text: '[]' }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } }), { headers: { 'content-type': 'application/json' } });
};
try {
  const r = await askClaude({ prompt: 'Judge via gateway', model: MODELS().judge });
  assert.equal(r.text, '[]'); assert.equal(requests, 1);
} finally { globalThis.fetch = originalFetch; }
console.log('Gateway: config, native search (incl. Grok), DeepSeek Search sources, judge routing, SDK transport and errors passed.');
