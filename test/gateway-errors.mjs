import assert from 'node:assert/strict';
import { RetryError } from 'ai';
import { gatewayFailure } from '../api/_lib/gateway-errors.js';

process.env.AI_GATEWAY_API_KEY = 'test-private-gateway-key';
const context = { engine: 'openai', model: 'openai/test', prompt: 'private user prompt', system: 'private system prompt' };
for (const [status, code] of [[400, 'bad_request'], [401, 'auth_failed'], [402, 'insufficient_credit'], [404, 'model_not_found'], [424, 'provider_unavailable'], [429, 'rate_limited'], [500, 'provider_error'], [408, 'timeout']]) {
  const inner = Object.assign(new Error('Unsupported argument; test-private-gateway-key; private user prompt; Bearer abc.def.ghi'), {
    statusCode: status, type: 'upstream_error', generationId: 'gen_123',
  });
  const wrapped = new RetryError({ message: 'Failed after retries', reason: 'maxRetriesExceeded', errors: [inner, inner] });
  const lines = [];
  const e = gatewayFailure(wrapped, context, (...args) => lines.push(args.join(' ')));
  assert.equal(e.code, code); assert.equal(e.extra.upstreamStatus, status);
  assert.equal(e.extra.generationId, 'gen_123'); assert.ok(e.message.includes('openai/test'));
  const combined = lines.join(' ') + JSON.stringify(e);
  for (const secret of ['test-private-gateway-key', 'private user prompt', 'abc.def.ghi']) assert.ok(!combined.includes(secret), secret);
  assert.match(lines[0], /Unsupported argument/);
}
const cyclic = new Error('failure'); cyclic.cause = cyclic;
assert.equal(gatewayFailure(cyclic, context, () => {}).code, 'provider_error');
console.log('Gateway errors: real SDK RetryError unwrapping, classification, correlation and redaction passed.');

// Exercise HTTP error decoding in the real SDK, including its retry wrapper.
const { askGateway } = await import('../api/_lib/gateway.js');
const oldFetch = globalThis.fetch, oldLog = console.error;
console.error = () => {};
try {
  for (const [status, type, code] of [[400,'invalid_request_error','bad_request'],[424,'failed_dependency','provider_unavailable'],[429,'rate_limit_exceeded','rate_limited']]) {
    globalThis.fetch = async () => new Response(JSON.stringify({error:{type,message:'Test upstream failure'},generationId:'gen_http'}),{status,headers:{'content-type':'application/json'}});
    await assert.rejects(askGateway('openai',{prompt:'test',deadline:Date.now()+10000}),e=>e.code===code && e.extra.generationId==='gen_http');
  }
} finally { globalThis.fetch=oldFetch;console.error=oldLog; }
console.log('Gateway HTTP errors: real SDK 400/424 and retried 429 passed.');
