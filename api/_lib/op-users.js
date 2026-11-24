import { route, ok, allowMethods, readJson, HttpError } from './util.js';
import { requireUser, clearAccessCache, isEnvAdmin, isAllowed } from './auth.js';
import { rest, authAdmin } from './supabase.js';
import { email as sendEmail, mailBody, appUrl } from './notify.js';

/* Quản lý người dùng của công cụ (chỉ quản trị viên). Tài khoản ở Supabase Auth; vai trò, khóa, bắt đổi mật khẩu ở bảng staff. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const ROLES = ['admin', 'member'];
const s = (v, n) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

async function requireAdmin(req, res) {
  const u = await requireUser(req, res);
  if (!u.isAdmin) throw new HttpError(403, 'not_admin', 'Chỉ quản trị viên mới quản lý được người dùng.');
  return u;
}
export function checkPassword(p) {
  p = String(p || '');
  if (p.length < 10 || p.length > 128 || !/\p{L}/u.test(p) || !/\d/.test(p)) throw new HttpError(400, 'weak_password', 'Mật khẩu cần từ 10 ký tự, có cả chữ và số.');
  return p;
}
const cleanEmail = (e) => { const x = s(e, 200).toLowerCase(); if (!EMAIL_RE.test(x)) throw new HttpError(400, 'bad_email', 'Email chưa đúng định dạng.'); return x; };

async function authUsers() {
  const out = [];
  for (let page = 1; page <= 10; page++) {
    const r = await authAdmin('GET', `users?page=${page}&per_page=200`);
    if (r.status !== 200) throw new HttpError(502, 'auth_error', 'Không đọc được danh sách tài khoản.');
    const list = (r.json && r.json.users) || [];
    out.push(...list);
    if (list.length < 200) break;
  }
  return out;
}
async function staffAll() {
  const r = await rest('GET', 'staff?select=*');
  if (r.status !== 200 || !Array.isArray(r.json)) throw new HttpError(502, 'db_error', 'Không đọc được bảng phân quyền.');
  return r.json;
}
function view(u, row) {
  const email = String(u.email || '').toLowerCase(), env = isEnvAdmin(email);
  const disabled = !!(row && row.disabled) && !env;
  return { id: u.id, email, name: (row && row.name) || (u.user_metadata && u.user_metadata.name) || '',
    role: env || (row && row.role === 'admin') ? 'admin' : 'member', disabled, envAdmin: env, mustChange: !!(row && row.must_change),
    access: env || (row ? !row.disabled : isAllowed(email)), managed: !!row,
    status: disabled ? 'disabled' : !u.last_sign_in_at ? (row && row.invited_at ? 'invited' : 'never') : 'active',
    lastSignIn: u.last_sign_in_at || null, createdAt: u.created_at || null };
}
async function everyone() {
  const [users, staff] = await Promise.all([authUsers(), staffAll()]);
  const by = new Map(staff.map((r) => [r.email, r]));
  return users.filter((u) => u.email).map((u) => view(u, by.get(String(u.email).toLowerCase())));
}
async function target(email) {
  const all = await everyone();
  const t = all.find((x) => x.email === email);
  if (!t) throw new HttpError(404, 'not_found', 'Không tìm thấy tài khoản.');
  return { t, all };
}
/** Sau thay đổi, hệ thống phải còn ít nhất một quản trị viên đang hoạt động. */
function keepAdmin(all, email, next) {
  const left = all.filter((x) => x.email !== email && x.role === 'admin' && !x.disabled && x.access).length + (next && next.role === 'admin' && !next.disabled ? 1 : 0);
  if (left < 1) throw new HttpError(400, 'last_admin', 'Hệ thống phải còn ít nhất một quản trị viên đang hoạt động.');
}
async function upsertStaff(row) {
  const r = await rest('POST', 'staff?on_conflict=email', { body: { ...row, updated_at: new Date().toISOString() }, prefer: 'resolution=merge-duplicates,return=representation' });
  if (r.status >= 300) throw new HttpError(502, 'db_error', 'Chưa lưu được phân quyền.');
  clearAccessCache(row.email);
}
async function makeLink(type, email, name) {
  const r = await authAdmin('POST', 'generate_link', { type, email, redirect_to: `${appUrl()}/`, ...(name ? { data: { name } } : {}) });
  const link = r.json && (r.json.action_link || (r.json.properties && r.json.properties.action_link));
  if (r.status >= 300 || !link) {
    const msg = String((r.json && (r.json.msg || r.json.message || r.json.error_description)) || '');
    throw new HttpError(r.status === 422 ? 409 : 502, r.status === 422 ? 'user_exists' : 'auth_error', r.status === 422 ? 'Email này đã có tài khoản.' : 'Không tạo được đường dẫn. ' + msg.slice(0, 120));
  }
  return link;
}
async function mailLink(email, name, link, invite) {
  const body = mailBody(invite ? 'Lời mời dùng công cụ AI Brand Readiness' : 'Đặt lại mật khẩu công cụ AI Brand Readiness', [
    `Chào ${name || 'anh/chị'},`,
    invite ? 'Anh/chị được mời dùng công cụ audit AI Brand Readiness của NetSpace tại app.brand.ai.vn. Bấm nút dưới đây để đặt mật khẩu và đăng nhập.' : 'Bấm nút dưới đây để đặt mật khẩu mới cho tài khoản của anh/chị tại app.brand.ai.vn.',
    'Đường dẫn chỉ dùng được một lần và có hiệu lực trong thời gian ngắn. Nếu không yêu cầu, hãy bỏ qua email này.',
  ], { href: link, label: invite ? 'Nhận lời mời và đặt mật khẩu' : 'Đặt mật khẩu mới' });
  return (await sendEmail({ to: email, subject: invite ? 'Lời mời dùng công cụ AI Brand Readiness' : 'Đặt lại mật khẩu – AI Brand Readiness', ...body })).sent;
}

/** GET /api/users */
export const list = route(async (req, res) => {
  allowMethods(req, ['GET']);
  const me = await requireAdmin(req, res);
  const users = (await everyone()).sort((a, b) => (a.role === b.role ? a.email.localeCompare(b.email) : a.role === 'admin' ? -1 : 1));
  ok(res, { users, me: me.email });
});

/** POST /api/users?op=create {email, name, role, method:'invite'|'password', password} */
export const create = route(async (req, res) => {
  allowMethods(req, ['POST']);
  const me = await requireAdmin(req, res);
  const b = await readJson(req, 4_000);
  const email = cleanEmail(b.email), name = s(b.name, 120), role = ROLES.includes(b.role) ? b.role : 'member';
  if (!['invite', 'password'].includes(b.method)) throw new HttpError(400, 'bad_method', 'Chọn cách cấp quyền: gửi email mời hoặc đặt mật khẩu tạm.');
  if ((await authUsers()).some((u) => String(u.email).toLowerCase() === email)) throw new HttpError(409, 'user_exists', 'Email này đã có tài khoản. Sửa quyền ở danh sách người dùng.');
  const now = new Date().toISOString();
  if (b.method === 'password') {
    const password = checkPassword(b.password);
    const r = await authAdmin('POST', 'users', { email, password, email_confirm: true, user_metadata: { name } });
    if (r.status >= 300) throw new HttpError(r.status === 422 ? 409 : 502, r.status === 422 ? 'user_exists' : 'auth_error', r.status === 422 ? 'Email này đã có tài khoản.' : 'Chưa tạo được tài khoản.');
    await upsertStaff({ email, name, role, disabled: false, must_change: true, created_by: me.email, updated_by: me.email });
    console.log('[users] created', email, role, 'temp-password by', me.email);
    return ok(res, { ok: true, method: 'password' });
  }
  const link = await makeLink('invite', email, name);
  await upsertStaff({ email, name, role, disabled: false, must_change: false, invited_at: now, created_by: me.email, updated_by: me.email });
  const sent = await mailLink(email, name, link, true);
  console.log('[users] invited', email, role, 'by', me.email, 'email', sent);
  ok(res, { ok: true, method: 'invite', emailSent: sent, ...(sent ? {} : { link }) });
});

/** POST /api/users?op=update {email, name?, role?, disabled?} */
export const update = route(async (req, res) => {
  allowMethods(req, ['POST']);
  const me = await requireAdmin(req, res);
  const b = await readJson(req, 4_000);
  const email = cleanEmail(b.email), { t, all } = await target(email);
  const next = { name: b.name !== undefined ? s(b.name, 120) : t.name, role: b.role !== undefined ? b.role : t.role, disabled: b.disabled !== undefined ? b.disabled === true : t.disabled };
  if (!ROLES.includes(next.role)) throw new HttpError(400, 'bad_role', 'Vai trò không hợp lệ.');
  if (email === me.email && (next.role !== 'admin' || next.disabled)) throw new HttpError(400, 'self', 'Không thể tự hạ quyền hoặc tự khóa tài khoản của chính mình.');
  if (t.envAdmin && (next.role !== 'admin' || next.disabled)) throw new HttpError(400, 'env_admin', 'Đây là quản trị viên dự phòng (ADMIN_EMAILS), không đổi được từ giao diện.');
  if (t.role === 'admin' && !t.disabled) keepAdmin(all, email, next);
  await upsertStaff({ email, name: next.name, role: next.role, disabled: next.disabled, updated_by: me.email });
  if (next.disabled !== t.disabled) await authAdmin('PUT', `users/${t.id}`, { ban_duration: next.disabled ? '876000h' : 'none' });
  console.log('[users] updated', email, JSON.stringify(next), 'by', me.email);
  ok(res, { user: { ...t, ...next, access: next.disabled ? false : true, status: next.disabled ? 'disabled' : t.status === 'disabled' ? (t.lastSignIn ? 'active' : 'never') : t.status } });
});

/** POST /api/users?op=password {email, method:'link'|'temp', password} – gửi link đặt lại hoặc đặt mật khẩu tạm. */
export const password = route(async (req, res) => {
  allowMethods(req, ['POST']);
  const me = await requireAdmin(req, res);
  const b = await readJson(req, 4_000);
  const email = cleanEmail(b.email), { t } = await target(email);
  if (b.method === 'temp') {
    const pw = checkPassword(b.password);
    const r = await authAdmin('PUT', `users/${t.id}`, { password: pw });
    if (r.status >= 300) throw new HttpError(502, 'auth_error', 'Chưa đặt được mật khẩu.');
    await upsertStaff({ email, name: t.name, role: t.role, disabled: t.disabled, must_change: true, updated_by: me.email });
    console.log('[users] temp password', email, 'by', me.email);
    return ok(res, { ok: true, method: 'temp' });
  }
  const link = await makeLink('recovery', email);
  const sent = await mailLink(email, t.name, link, false);
  console.log('[users] reset link', email, 'by', me.email, 'email', sent);
  ok(res, { ok: true, method: 'link', emailSent: sent, ...(sent ? {} : { link }) });
});

/** POST /api/users?op=remove {email} – xóa tài khoản (audit, khách tiềm năng là dữ liệu chung nên được giữ). */
export const remove = route(async (req, res) => {
  allowMethods(req, ['POST']);
  const me = await requireAdmin(req, res);
  const b = await readJson(req, 2_000);
  const email = cleanEmail(b.email), { t, all } = await target(email);
  if (email === me.email) throw new HttpError(400, 'self', 'Không thể tự xóa tài khoản của chính mình.');
  if (t.envAdmin) throw new HttpError(400, 'env_admin', 'Đây là quản trị viên dự phòng (ADMIN_EMAILS), không xóa được từ giao diện.');
  if (t.role === 'admin' && !t.disabled) keepAdmin(all, email, null);
  const r = await authAdmin('DELETE', `users/${t.id}`);
  if (r.status >= 300) throw new HttpError(502, 'auth_error', 'Chưa xóa được tài khoản.');
  await rest('DELETE', `staff?email=eq.${encodeURIComponent(email)}`);
  clearAccessCache(email);
  console.log('[users] removed', email, 'by', me.email);
  ok(res, { deleted: true });
});

/** Nhân viên đang có quyền vào công cụ (để giao khách tiềm năng). */
export async function activeStaff() {
  return (await everyone()).filter((u) => u.access && !u.disabled).map((u) => ({ email: u.email, name: u.name || '' })).sort((a, b) => (a.name || a.email).localeCompare(b.name || b.email, 'vi'));
}
