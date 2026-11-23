import { httpJSON, HttpError, getIp } from './util.js';

/** Xác minh Cloudflare Turnstile. Thiếu khóa bí mật: chặn ở production, bỏ qua khi chạy thử cục bộ. */
export async function verifyTurnstile(req, token) {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) {
    if (process.env.VERCEL === '1') throw new HttpError(503, 'not_configured', 'Chưa cấu hình chống bot (TURNSTILE_SECRET_KEY).');
    return true;
  }
  if (typeof token !== 'string' || token.length < 2 || token.length > 4096) throw new HttpError(400, 'captcha_required', 'Vui lòng hoàn tất bước xác minh chống bot.');
  const url = process.env.TURNSTILE_VERIFY_URL || 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
  const r = await httpJSON(url, { headers: { 'Content-Type': 'application/json' }, body: { secret, response: token, remoteip: getIp(req) }, timeoutMs: 8000, retries: 1 });
  if (r.status !== 200 || !r.json || r.json.success !== true) throw new HttpError(400, 'captcha_failed', 'Xác minh chống bot không thành công. Tải lại trang và thử lại.');
  return true;
}
