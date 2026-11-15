import dns from 'node:dns/promises';
import net from 'node:net';
import { HttpError } from './util.js';

export const UA = 'Mozilla/5.0 (compatible; NetSpace-CheckAI/1.0; +https://checkai.netspace.vn)';

/** Địa chỉ nội bộ/đặc biệt không được phép truy cập (chống SSRF). */
export function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
  }
  if (net.isIPv6(ip)) {
    const x = ip.toLowerCase();
    if (x.startsWith('::ffff:')) return isPrivateIp(x.slice(7));
    return x === '::' || x === '::1' || x.startsWith('fc') || x.startsWith('fd') || x.startsWith('fe8') || x.startsWith('fe9') || x.startsWith('fea') || x.startsWith('feb') || x.startsWith('ff');
  }
  return true;
}
// Chỉ dùng khi chạy thử cục bộ; trên Vercel (VERCEL=1) luôn chặn địa chỉ nội bộ.
const allowPrivate = () => process.env.SCAN_ALLOW_PRIVATE === '1' && process.env.VERCEL !== '1';

export async function assertPublicHost(hostname) {
  if (allowPrivate()) return;
  const h = hostname.replace(/^\[|\]$/g, '');
  const addrs = net.isIP(h) ? [{ address: h }] : await dns.lookup(h, { all: true }).catch(() => []);
  if (!addrs.length) throw new HttpError(400, 'dns_failed', `Không phân giải được tên miền ${hostname}.`);
  if (addrs.some(a => isPrivateIp(a.address))) throw new HttpError(400, 'blocked_host', 'Địa chỉ này không được phép quét.');
}

export function normalizeTarget(input) {
  let s = String(input || '').trim();
  if (!s) throw new HttpError(400, 'bad_url', 'Nhập địa chỉ website.');
  if (/^[a-z][a-z0-9+.-]*:/i.test(s) && !/^https?:\/\//i.test(s) && !/^[^:/]+:\d+/.test(s)) throw new HttpError(400, 'bad_url', 'Chỉ hỗ trợ http/https.');
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
  let u;
  try { u = new URL(s); } catch { throw new HttpError(400, 'bad_url', 'Địa chỉ website không hợp lệ.'); }
  if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password) throw new HttpError(400, 'bad_url', 'Chỉ hỗ trợ http/https.');
  if (u.port && !['80', '443'].includes(u.port) && !allowPrivate()) throw new HttpError(400, 'bad_url', 'Chỉ hỗ trợ cổng 80/443.');
  u.hash = '';
  return u;
}

/** fetch an toàn: kiểm tra từng bước chuyển hướng, giới hạn thời gian và dung lượng. Không ném lỗi HTTP; trả {status,...}. */
export async function safeFetch(url, { timeoutMs = 10000, maxBytes = 2_000_000, maxRedirects = 5, userAgent = UA, accept = 'text/html,application/xhtml+xml,*/*;q=0.8' } = {}) {
  let u = normalizeTarget(url);
  const started = Date.now();
  for (let i = 0; i <= maxRedirects; i++) {
    await assertPublicHost(u.hostname);
    let r;
    try {
      r = await fetch(u, { redirect: 'manual', signal: AbortSignal.timeout(timeoutMs), headers: { 'User-Agent': userAgent, Accept: accept, 'Accept-Language': 'vi,en;q=0.8' } });
    } catch (e) {
      return { ok: false, status: 0, error: e && e.name === 'TimeoutError' ? 'timeout' : 'network', url: u.href, ms: Date.now() - started };
    }
    if ([301, 302, 303, 307, 308].includes(r.status) && r.headers.get('location')) {
      try { r.body && await r.body.cancel(); } catch { /* bỏ qua */ }
      u = normalizeTarget(new URL(r.headers.get('location'), u).href);
      continue;
    }
    let text = '', bytes = 0, truncated = false;
    if (r.body) {
      const reader = r.body.getReader(), dec = new TextDecoder('utf-8');
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.length;
        if (bytes > maxBytes) { truncated = true; try { await reader.cancel(); } catch { /* bỏ qua */ } break; }
        text += dec.decode(value, { stream: true });
      }
    }
    return { ok: r.ok, status: r.status, url: u.href, headers: r.headers, text, bytes, truncated, ms: Date.now() - started, redirects: i };
  }
  return { ok: false, status: 0, error: 'too_many_redirects', url: u.href, ms: Date.now() - started };
}
