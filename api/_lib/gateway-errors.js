import { randomUUID } from 'node:crypto';
import { HttpError } from './util.js';

function chainOf(error) {
  const chain = [], seen = new Set(), queue = [error];
  while (queue.length && chain.length < 16) {
    const e = queue.shift();
    if (!e || typeof e !== 'object' || seen.has(e)) continue;
    seen.add(e); chain.push(e);
    queue.push(e.lastError, e.cause, ...(Array.isArray(e.errors) ? e.errors.slice(-4) : []));
  }
  return chain;
}

function safeText(value, privateText = []) {
  let text = String(value || '');
  for (const secret of [...privateText, ...Object.entries(process.env)
    .filter(([k]) => /KEY|TOKEN|SECRET|PASSWORD/i.test(k)).map(([, v]) => v)].filter(Boolean).sort((a,b) => b.length-a.length)) {
    if (secret) text = text.split(secret).join('[redacted]');
  }
  return text.replace(/Bearer\s+[^\s"',;]+/gi, 'Bearer [redacted]')
    .replace(/\b(?:sk-|vck_|sb_secret_)[A-Za-z0-9_-]+/g, '[redacted]')
    .replace(/\s+/g, ' ').slice(0, 500);
}

export function gatewayFailure(error, { engine, model, prompt, system }, log = console.error) {
  const chain = chainOf(error);
  // RetryError wraps the provider error in lastError; nested cause can wrap it again.
  const upstream = chain.find(e => Number.isInteger(e.statusCode)) || chain.at(-1) || {};
  const status = upstream.statusCode;
  const timedOut = chain.some(e => ['TimeoutError', 'AbortError', 'AI_GatewayTimeoutError'].includes(e.name)) || status === 408 || status === 504;
  const detail = safeText(upstream.message, [prompt, system]);
  let code = 'provider_error', message = 'không hoàn tất được yêu cầu', httpStatus = 502;
  if (status === 401 || status === 403) { code = 'auth_failed'; message = 'key không hợp lệ hoặc chưa được cấp quyền'; }
  else if (status === 402) { code = 'insufficient_credit'; message = 'không đủ số dư; kiểm tra credit trên Vercel'; }
  else if (status === 429) { code = 'rate_limited'; message = 'vượt giới hạn tốc độ hoặc hạn mức'; }
  else if (status === 404) { code = 'model_not_found'; message = 'không tìm thấy model; kiểm tra biến AI_GATEWAY_*_MODEL'; }
  else if (status === 400 || status === 422) { code = 'bad_request'; message = 'model từ chối tham số hoặc công cụ tìm kiếm'; }
  else if (status === 424) { code = 'provider_unavailable'; message = 'nhà cung cấp phía sau Gateway không xử lý được yêu cầu'; }
  else if (timedOut) { code = 'timeout'; message = 'hết thời gian chờ'; httpStatus = 504; }
  const errorId = randomUUID();
  const metadata = {
    errorId, engine, model: safeText(model), upstreamStatus: status || null,
    upstreamType: safeText(upstream.type || upstream.name),
    generationId: safeText(chain.find(e => e.generationId)?.generationId) || null,
  };
  // Never log the error object: SDK errors can contain Authorization and request bodies.
  log('[ai-gateway]', JSON.stringify({ ...metadata, detail }));
  return new HttpError(httpStatus, code,
    `AI Gateway (${engine}, ${safeText(model)}${status ? ', HTTP ' + status : ''}): ${message}.${detail ? ' ' + detail : ''} [Mã lỗi: ${errorId}]`, metadata);
}
