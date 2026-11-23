import { HttpError, assertCsrf, parseCookies, cookie, sha } from './util.js';
import { authUser, authRefresh, rest } from './supabase.js';

const list = (name) => (process.env[name] || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);

/** Đóng-mặc-định: nếu không cấu hình allowlist thì không ai được vào. */
/** Quản trị viên "dự phòng" theo biến ADMIN_EMAILS: luôn có quyền quản trị, không thể bị khóa hay xóa từ giao diện. */
export function isAdmin(email) {
  const admins = String(process.env.ADMIN_EMAILS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  return !!email && admins.includes(String(email).toLowerCase());
}
export const isEnvAdmin = isAdmin;

/* Quyền truy cập: bảng staff (vai trò, khóa) + allowlist theo tên miền/biến môi trường. Lưu đệm 30 giây. */
const accessCache = new Map();
// Thế hệ bộ đệm: mỗi lần xóa thì tăng, để một lần đọc đang dở (bắt đầu trước khi xóa) không ghi lại trạng thái cũ.
let accessGen = 0;
export const clearAccessCache = (email) => { accessGen++; return email ? accessCache.delete(String(email).toLowerCase()) : accessCache.clear(); };
export async function staffRow(email) {
  const r = await rest('GET', `staff?email=eq.${encodeURIComponent(String(email).toLowerCase())}&select=*`);
  // Chưa chạy SQL 005 (chưa có bảng staff): quay về allowlist theo tên miền/ADMIN_EMAILS thay vì khóa cả nhóm.
  const code = r.json && (r.json.code || '');
  if (r.status === 404 || code === '42P01' || code === 'PGRST205') { console.warn('[auth] bảng staff chưa có – dùng allowlist theo biến môi trường. Chạy supabase/migrations/005_staff.sql.'); return null; }
  if (r.status !== 200 || !Array.isArray(r.json)) throw new HttpError(503, 'db_error', 'Không kiểm tra được quyền truy cập.');
  return r.json[0] || null;
}
export async function accessFor(email) {
  const e = String(email || '').toLowerCase();
  if (!e.includes('@')) return { allowed: false };
  const sig = [process.env.ALLOWED_EMAILS, process.env.ALLOWED_EMAIL_DOMAINS, process.env.ADMIN_EMAILS].join('|');
  const c = accessCache.get(e);
  if (c && c.exp > Date.now() && c.sig === sig) return c.v;
  const gen = accessGen;
  const row = await staffRow(e);
  const env = isAdmin(e);
  const v = { allowed: env || (row ? !row.disabled : isAllowed(e)), role: env || (row && row.role === 'admin') ? 'admin' : 'member',
    isAdmin: env || (!!row && row.role === 'admin' && !row.disabled), envAdmin: env, name: (row && row.name) || '', mustChange: !!(row && row.must_change), disabled: !!(row && row.disabled) };
  if (accessCache.size > 500) accessCache.clear();
  if (gen === accessGen) accessCache.set(e, { v, sig, exp: Date.now() + 30_000 });
  return v;
}

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
  const a = await accessFor(user.email);
  if (!a.allowed) throw new HttpError(403, 'not_allowed', a.disabled ? 'Tài khoản đã bị khóa. Liên hệ quản trị viên.' : 'Tài khoản chưa được cấp quyền dùng công cụ này.');
  return { email: String(user.email).toLowerCase(), id: user.id, role: a.role, isAdmin: a.isAdmin, envAdmin: a.envAdmin, name: a.name, mustChange: a.mustChange };
}
