import { route, ok, fail, allowMethods, readJson, assertCsrf, getIp, HttpError } from './_lib/util.js';
import { authPassword } from './_lib/supabase.js';
import { isAllowed, setSession } from './_lib/auth.js';

const BAD = 'Email hoặc mật khẩu không đúng, hoặc tài khoản chưa được cấp quyền.';
const tries = new Map(); // làm chậm thử mật khẩu hàng loạt (best-effort theo từng instance)

export default route(async (req, res) => {
  allowMethods(req, ['POST']);
  assertCsrf(req);
  const body = await readJson(req, 10_000);
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  if (!email || !password || email.length > 200 || password.length > 200) throw new HttpError(400, 'bad_request', 'Nhập email và mật khẩu.');

  const key = `${getIp(req)}|${email}`;
  const now = Date.now();
  const rec = (tries.get(key) || []).filter((t) => now - t < 15 * 60_000);
  if (rec.length >= 8) throw new HttpError(429, 'too_many_attempts', 'Thử đăng nhập quá nhiều lần. Đợi 15 phút rồi thử lại.');

  // Kiểm tra allowlist TRƯỚC khi gọi Supabase; trả cùng một thông báo để không lộ ai được phép.
  const r = isAllowed(email) ? await authPassword(email, password) : { status: 400 };
  if (r.status !== 200 || !r.json || !r.json.access_token) {
    rec.push(now);
    tries.set(key, rec);
    if (tries.size > 2000) tries.clear();
    return fail(res, 401, 'invalid_credentials', BAD);
  }
  const userEmail = r.json.user && r.json.user.email;
  if (!isAllowed(userEmail)) return fail(res, 401, 'invalid_credentials', BAD);
  tries.delete(key);
  setSession(res, r.json);
  ok(res, { email: String(userEmail).toLowerCase() });
});
