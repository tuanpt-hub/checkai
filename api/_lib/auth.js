import { HttpError, assertCsrf, parseCookies, cookie, sha } from './util.js';
import { authUser, authRefresh } from './supabase.js';

const list = (name) => (process.env[name] || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);

/** Đóng-mặc-định: nếu không cấu hình allowlist thì không ai được vào. */
export function isAllowed(email) {
  const e = String(email || '').toLowerCase();
  if (!e || !e.includes('@')) return false;
  const emails = list('ALLOWED_EMAILS');
  const domains = list('ALLOWED_EMAIL_DOMAINS').map((d) => d.replace(/^@/, ''));
  if (!emails.length && !domains.length) return false;
  return emails.includes(e) || domains.includes(e.split('@').pop());
}

export function setSession(res, t) {
  res.setHeader('Set-Cookie', [
    cookie('abr_at', t.access_token, { maxAge: Math.max(60, Number(t.expires_in) || 3600) }),
    cookie('abr_rt', t.refresh_token, { maxAge: 60 * 60 * 24 * 14 }),
  ]);
}
export function clearSession(res) {
  res.setHeader('Set-Cookie', [cookie('abr_at', '', { maxAge: 0 }), cookie('abr_rt', '', { maxAge: 0 })]);
}

const cache = new Map();
async function userFromToken(at) {
  const k = sha(at).slice(0, 24);
  const c = cache.get(k);
  if (c && c.exp > Date.now()) return c.user;
  const user = await authUser(at);
  if (user) {
    if (cache.size > 500) cache.clear();
    cache.set(k, { user, exp: Date.now() + 30_000 });
  }
  return user;
}

/** Bắt buộc đăng nhập + nằm trong allowlist. Trả {email,id}; ném HttpError nếu không hợp lệ. */
export async function requireUser(req, res) {
  assertCsrf(req);
  const ck = parseCookies(req);
  let user = ck.abr_at ? await userFromToken(ck.abr_at) : null;
  if (!user && ck.abr_rt) {
    const r = await authRefresh(ck.abr_rt);
    if (r.status === 200 && r.json && r.json.access_token) {
      setSession(res, r.json);
      user = await userFromToken(r.json.access_token);
    }
  }
  if (!user) throw new HttpError(401, 'unauthorized', 'Cần đăng nhập.');
  if (!isAllowed(user.email)) throw new HttpError(403, 'not_allowed', 'Tài khoản chưa được cấp quyền dùng công cụ này.');
  return { email: String(user.email).toLowerCase(), id: user.id };
}
