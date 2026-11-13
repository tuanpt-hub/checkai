import assert from 'node:assert/strict';
import { askGateway } from '../api/_lib/gateway.js';
import { configured, MODELS, askClaude } from '../api/_lib/providers.js';

process.env.AI_GATEWAY_API_KEY = 'gateway-test-secret';
for (const k of ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'GEMINI_API_KEY']) delete process.env[k];
assert.deepEqual(configured(), { claude: true, openai: true, gemini: true });
assert.equal(MODELS().claude, 'anthropic/claude-sonnet-5.5');
for (const [engine, tool] of [['claude', 'web_search'], ['openai', 'web_search'], ['gemini', 'google_search']]) {
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
  assert.equal(String(url), 'https://ai-gateway.vercel.sh/v4/ai/language-model');
  assert.match(JSON.stringify(init.headers), /gateway-test-secret/);
  const body = JSON.parse(init.body);
  assert.equal(body.prompt.at(-1).content[0].text, 'Judge via gateway');
  return new Response(JSON.stringify({ content: [{ type: 'text', text: '[]' }], finishReason: { unified: 'stop', raw: 'stop' }, usage: { inputTokens: { total: 1 }, outputTokens: { total: 1 } }, warnings: [] }), { headers: { 'content-type': 'application/json' } });
};
try {
  const r = await askClaude({ prompt: 'Judge via gateway', model: MODELS().judge });
  assert.equal(r.text, '[]'); assert.equal(requests, 1);
} finally { globalThis.fetch = originalFetch; }
console.log('Gateway: config, native search, sources, judge routing, SDK transport and errors passed.');
