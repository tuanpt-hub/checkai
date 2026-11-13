import crypto from 'node:crypto';

export class HttpError extends Error {
  constructor(status, code, message, extra) {
    super(message || code);
    this.status = status;
    this.code = code;
    this.extra = extra || {};
  }
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const envInt = (name, def) => {
  const n = parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(n) && n > 0 ? n : def;
};
export const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');

export function send(res, status, obj) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(obj));
}
export const ok = (res, obj) => send(res, 200, obj);
export const fail = (res, status, code, message, extra) =>
  send(res, status, { error: { code, message: message || code, ...(extra || {}) } });

/** Bọc handler: bắt lỗi, không bao giờ làm lộ chi tiết nội bộ hay khóa API. */
export function route(fn) {
  return async (req, res) => {
    try {
      await fn(req, res);
    } catch (e) {
      if (e instanceof HttpError) return fail(res, e.status, e.code, e.message, e.extra);
      console.error('[api]', req.method, req.url, e && e.stack ? e.stack : e);
      fail(res, 500, 'server_error', 'Lỗi máy chủ. Thử lại sau ít phút.');
    }
  };
}

export async function readJson(req, maxBytes = 4_000_000) {
  if (req.body !== undefined && req.body !== null) {
    if (typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
    const s = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : String(req.body);
    if (!s) return {};
    try { return JSON.parse(s); } catch { throw new HttpError(400, 'bad_json', 'Dữ liệu gửi lên không phải JSON hợp lệ.'); }
  }
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > maxBytes) throw new HttpError(413, 'too_large', 'Dữ liệu quá lớn.');
    chunks.push(c);
  }
  const s = Buffer.concat(chunks).toString('utf8');
  if (!s) return {};
  try { return JSON.parse(s); } catch { throw new HttpError(400, 'bad_json', 'Dữ liệu gửi lên không phải JSON hợp lệ.'); }
}

export function allowMethods(req, list) {
  if (!list.includes(req.method)) throw new HttpError(405, 'method_not_allowed', 'Phương thức không được hỗ trợ.');
}

/** Chống CSRF: mọi yêu cầu ghi phải có header tự đặt + cùng nguồn gốc. Cookie đã SameSite=Strict. */
export function assertCsrf(req) {
  if (req.method === 'GET' || req.method === 'HEAD') return;
  if (req.headers['x-abr'] !== '1') throw new HttpError(403, 'csrf', 'Yêu cầu bị từ chối.');
  const origin = req.headers.origin;
  if (origin) {
    let host = '';
    try { host = new URL(origin).host; } catch { /* ignore */ }
    const mine = req.headers['x-forwarded-host'] || req.headers.host;
    if (host !== mine) throw new HttpError(403, 'csrf', 'Yêu cầu bị từ chối.');
  }
}

export function getIp(req) {
  const xf = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return xf || String(req.headers['x-real-ip'] || '') || (req.socket && req.socket.remoteAddress) || 'unknown';
}

export function parseCookies(req) {
  const out = {};
  const h = req.headers.cookie || '';
  for (const part of h.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    let v = part.slice(i + 1).trim();
    try { v = decodeURIComponent(v); } catch { /* giữ nguyên */ }
    out[k] = v;
  }
  return out;
}

export function cookie(name, value, { maxAge = 0 } = {}) {
  const secure = process.env.COOKIE_INSECURE === '1' ? '' : '; Secure';
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`;
}

/** fetch có timeout + thử lại khi 429/5xx. Trả {status,json,text}. */
export async function httpJSON(url, { method = 'POST', headers = {}, body, timeoutMs = 90000, retries = 2, deadline } = {}) {
  let attempt = 0;
  for (;;) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const r = await fetch(url, {
        method,
        headers,
        body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
        signal: ctl.signal,
      });
      const text = await r.text();
      clearTimeout(timer);
      let json = null;
      try { json = text ? JSON.parse(text) : null; } catch { /* không phải JSON */ }
      const canRetry = attempt < retries && (!deadline || Date.now() + 4000 < deadline);
      if ((r.status === 429 || r.status >= 500) && canRetry) {
        attempt++;
        const ra = Number(r.headers.get('retry-after')) || 0;
        await sleep(Math.min(Math.max(ra * 1000, 1200 * attempt), 6000));
        continue;
      }
      return { status: r.status, json, text };
    } catch (e) {
      clearTimeout(timer);
      const canRetry = attempt < retries && (!deadline || Date.now() + 4000 < deadline);
      if (canRetry) { attempt++; await sleep(1200 * attempt); continue; }
      const aborted = e && e.name === 'AbortError';
      throw new HttpError(504, aborted ? 'timeout' : 'network', aborted ? 'Hết thời gian chờ nhà cung cấp.' : 'Không kết nối được tới nhà cung cấp.');
    }
  }
}

export function extractJSON(text) {
  let s = String(text || '').trim();
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  try { return JSON.parse(s); } catch { /* thử cách khác */ }
  const a = s.search(/[\[{]/);
  if (a < 0) return null;
  const close = s[a] === '[' ? ']' : '}';
  const b = s.lastIndexOf(close);
  if (b <= a) return null;
  try { return JSON.parse(s.slice(a, b + 1)); } catch { return null; }
}
