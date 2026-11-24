import { route, ok, allowMethods, readJson, assertCsrf, HttpError } from './util.js';
import { requireUser, accessFor, setSession, clearAccessCache } from './auth.js';
import { authUser, authUpdateSelf, authPassword, authAdmin, rest } from './supabase.js';
import { limitIp } from './intake.js';
import { checkPassword } from './op-users.js';

const clearMustChange = async (email) => { await rest('PATCH', `staff?email=eq.${encodeURIComponent(email)}`, { body: { must_change: false, updated_at: new Date().toISOString() } }); clearAccessCache(email); };

/** POST /api/me?op=setpw – đặt mật khẩu từ đường dẫn mời / đặt lại (Supabase trả phiên trong phần # của URL). */
export const setpw = route(async (req, res) => {
  allowMethods(req, ['POST']);
  assertCsrf(req);
  await limitIp(req, 'setpw', 10, 15 * 60_000, { shared: true });
  const b = await readJson(req, 8_000);
  const at = String(b.access_token || ''), rt = String(b.refresh_token || '');
  if (at.length < 20 || at.length > 4000) throw new HttpError(400, 'bad_link', 'Đường dẫn không hợp lệ. Mở lại đường dẫn trong email.');
  const password = checkPassword(b.password);
  const user = await authUser(at);
  if (!user) throw new HttpError(401, 'link_expired', 'Đường dẫn đã hết hạn hoặc đã được dùng. Nhờ quản trị viên gửi lại.');
  const a = await accessFor(user.email);
  if (!a.allowed) throw new HttpError(403, 'not_allowed', 'Tài khoản chưa được cấp quyền hoặc đã bị khóa.');
  const r = await authUpdateSelf(at, { password });
  if (r.status >= 300) throw new HttpError(400, 'password_rejected', 'Chưa đặt được mật khẩu. Thử một mật khẩu khác.');
  await clearMustChange(String(user.email).toLowerCase());
  setSession(res, { access_token: at, refresh_token: rt, expires_in: Number(b.expires_in) || 3600 });
  ok(res, { email: String(user.email).toLowerCase() });
});

/** POST /api/me?op=password {current, password} – tự đổi mật khẩu; sau mật khẩu tạm thì không cần mật khẩu hiện tại. */
export const password = route(async (req, res) => {
  allowMethods(req, ['POST']);
  await limitIp(req, 'chpw', 10, 15 * 60_000, { shared: true });
  const user = await requireUser(req, res);
  const b = await readJson(req, 4_000);
  const pw = checkPassword(b.password);
  if (!user.mustChange) {
    const r = await authPassword(user.email, String(b.current || ''));
    if (r.status !== 200) throw new HttpError(400, 'wrong_password', 'Mật khẩu hiện tại chưa đúng.');
  }
  const u = await authAdmin('PUT', `users/${user.id}`, { password: pw });
  if (u.status >= 300) throw new HttpError(502, 'auth_error', 'Chưa đổi được mật khẩu.');
  await clearMustChange(user.email);
  ok(res, { ok: true });
});
