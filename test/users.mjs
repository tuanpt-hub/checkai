import assert from 'node:assert/strict';
import { startFakes, startFakeNotify, USERS } from './fakes.js';
import { startServer } from '../scripts/dev.js';

// Quản lý người dùng: vai trò, mời qua email, mật khẩu tạm, khóa, đặt lại mật khẩu, xóa, email ngoài, luật bảo vệ.
const f = await startFakes(), nt = await startFakeNotify();
Object.assign(process.env, { SUPABASE_URL: `http://127.0.0.1:${f.ports.supabase}`, SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test', SUPABASE_SECRET_KEY: 'sb_secret_test', ALLOWED_EMAIL_DOMAINS: 'netspace.vn',
  COOKIE_INSECURE: '1', APP_URL: 'https://app.brand.ai.vn', ...nt.env });
delete process.env.ADMIN_EMAILS; delete process.env.VERCEL;
const server = await startServer(0), base = `http://127.0.0.1:${server.address().port}`;
const jar = {};
const call = async (who, path, body) => {
  const r = await fetch(base + path, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', 'X-ABR': '1', ...(jar[who] ? { Cookie: jar[who] } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const set = r.headers.getSetCookie(); if (set.length) jar[who] = set.map((c) => c.split(';')[0]).filter((c) => !/=$/.test(c)).join('; ');
  let data = null; try { data = await r.json(); } catch { /* trống */ } return { status: r.status, data };
};
const login = (who, email, password) => call(who, '/api/me?op=login', { email, password });
const linkTokens = () => { const m = nt.sent.emails.at(-1).text.match(/#access_token=([^&\s]+)&refresh_token=([^&\s]+)/); return { access_token: m[1], refresh_token: m[2], expires_in: 3600 }; };
let ok = true; const t = async (name, fn) => { try { await fn(); console.log('  ✓ ' + name); } catch (e) { ok = false; console.log('  ✗ ' + name + '\n    ' + String(e.message).split('\n').slice(0, 6).join('\n    ')); } };
try {
  await t('chưa có quản trị viên: nhân viên không mở được quản lý người dùng', async () => {
    assert.equal((await login('A', 'staff@netspace.vn', USERS['staff@netspace.vn'])).status, 200);
    const me = await call('A', '/api/me'); assert.equal(me.data.isAdmin, false); assert.equal(me.data.role, 'member');
    assert.equal((await call('A', '/api/users')).status, 403);
    assert.equal((await call('A', '/api/users?op=create', { email: 'x@y.vn', method: 'invite' })).status, 403);
  });
  process.env.ADMIN_EMAILS = 'staff@netspace.vn';
  await t('quản trị viên dự phòng (ADMIN_EMAILS) xem được danh sách; email ngoài chưa có quyền hiện "không có quyền"', async () => {
    const r = await call('A', '/api/users'); assert.equal(r.status, 200, JSON.stringify(r.data));
    const me = r.data.users.find((u) => u.email === 'staff@netspace.vn'), out = r.data.users.find((u) => u.email === 'outsider@gmail.com');
    assert.equal(me.role, 'admin'); assert.equal(me.envAdmin, true); assert.equal(out.access, false); assert.equal(out.role, 'member');
    assert.equal((await login('O', 'outsider@gmail.com', USERS['outsider@gmail.com'])).status, 401);
  });
  await t('mời qua email (email ngoài): gửi link, người được mời tự đặt mật khẩu và vào được', async () => {
    const e0 = nt.sent.emails.length;
    const r = await call('A', '/api/users?op=create', { email: 'Partner@Gmail.com', name: 'Chị Hoa (đối tác)', role: 'member', method: 'invite' });
    assert.equal(r.status, 200, JSON.stringify(r.data)); assert.equal(r.data.emailSent, true); assert.equal(r.data.link, undefined, 'link only returned when email failed');
    const mail = nt.sent.emails[e0]; assert.deepEqual(mail.to, ['partner@gmail.com']); assert.match(mail.text, /https:\/\/app\.brand\.ai\.vn\/#access_token=/);
    const u = (await call('A', '/api/users')).data.users.find((x) => x.email === 'partner@gmail.com'); assert.equal(u.status, 'invited'); assert.equal(u.name, 'Chị Hoa (đối tác)'); assert.equal(u.access, true);
    assert.equal((await call('P', '/api/me?op=setpw', { ...linkTokens(), password: 'ngan' })).data.error.code, 'weak_password');
    const s = await call('P', '/api/me?op=setpw', { ...linkTokens(), password: 'MatKhau-Moi-2026' }); assert.equal(s.status, 200, JSON.stringify(s.data));
    const me = await call('P', '/api/me'); assert.equal(me.status, 200); assert.equal(me.data.email, 'partner@gmail.com'); assert.equal(me.data.mustChange, false);
    assert.equal((await login('P2', 'partner@gmail.com', 'MatKhau-Moi-2026')).status, 200);
    assert.equal((await call('A', '/api/users?op=create', { email: 'partner@gmail.com', method: 'invite' })).status, 409, 'duplicate');
  });
  await t('mật khẩu tạm: đăng nhập được nhưng bắt đổi; đổi xong thì hết bắt buộc', async () => {
    assert.equal((await call('A', '/api/users?op=create', { email: 'ctv@abc.com', name: 'CTV', role: 'member', method: 'password', password: '123456' })).data.error.code, 'weak_password');
    assert.equal((await call('A', '/api/users?op=create', { email: 'ctv@abc.com', name: 'CTV', role: 'member', method: 'password', password: 'TamThoi-2026x' })).status, 200);
    assert.equal((await login('C', 'ctv@abc.com', 'TamThoi-2026x')).status, 200);
    assert.equal((await call('C', '/api/me')).data.mustChange, true);
    assert.equal((await call('C', '/api/me?op=password', { password: 'CuaRieng-2026y' })).status, 200, 'no current password needed after temp');
    assert.equal((await call('C', '/api/me')).data.mustChange, false);
    assert.equal((await call('C', '/api/me?op=password', { password: 'Khac-2026zz' })).data.error.code, 'wrong_password', 'normal change needs current');
    assert.equal((await call('C', '/api/me?op=password', { current: 'CuaRieng-2026y', password: 'Khac-2026zz' })).status, 200);
    assert.equal((await login('C2', 'ctv@abc.com', 'Khac-2026zz')).status, 200);
  });
  await t('đổi vai trò: nhân viên thành quản trị viên thì quản lý được người dùng', async () => {
    assert.equal((await call('C', '/api/users')).status, 403);
    const r = await call('A', '/api/users?op=update', { email: 'ctv@abc.com', role: 'admin' }); assert.equal(r.status, 200); assert.equal(r.data.user.role, 'admin');
    assert.equal((await call('C', '/api/users')).status, 200);
    assert.equal((await call('C', '/api/me')).data.isAdmin, true);
    assert.equal((await call('A', '/api/users?op=update', { email: 'ctv@abc.com', role: 'member' })).status, 200);
  });
  await t('khóa tài khoản: chặn đăng nhập mới và cả phiên đang mở; mở khóa thì vào lại được', async () => {
    assert.equal((await call('A', '/api/users?op=update', { email: 'partner@gmail.com', disabled: true })).status, 200);
    const me = await call('P2', '/api/me'); assert.ok([401, 403].includes(me.status), 'open session blocked: ' + me.status);
    assert.equal((await login('P3', 'partner@gmail.com', 'MatKhau-Moi-2026')).status, 401);
    assert.equal((await call('A', '/api/users')).data.users.find((x) => x.email === 'partner@gmail.com').status, 'disabled');
    assert.equal((await call('A', '/api/users?op=update', { email: 'partner@gmail.com', disabled: false })).status, 200);
    assert.equal((await login('P3', 'partner@gmail.com', 'MatKhau-Moi-2026')).status, 200);
  });
  await t('đặt lại mật khẩu: gửi link (người dùng tự đặt) hoặc đặt mật khẩu tạm (bắt đổi)', async () => {
    const e0 = nt.sent.emails.length;
    assert.equal((await call('A', '/api/users?op=password', { email: 'partner@gmail.com', method: 'link' })).data.emailSent, true);
    assert.match(nt.sent.emails[e0].subject, /Đặt lại mật khẩu/);
    assert.equal((await call('P4', '/api/me?op=setpw', { ...linkTokens(), password: 'SauReset-2026' })).status, 200);
    assert.equal((await login('P5', 'partner@gmail.com', 'SauReset-2026')).status, 200);
    assert.equal((await call('A', '/api/users?op=password', { email: 'partner@gmail.com', method: 'temp', password: 'TamLan2-2026' })).status, 200);
    assert.equal((await login('P6', 'partner@gmail.com', 'TamLan2-2026')).status, 200); assert.equal((await call('P6', '/api/me')).data.mustChange, true);
  });
  await t('luật bảo vệ: không tự hạ quyền, tự khóa, tự xóa; không đụng quản trị viên dự phòng', async () => {
    assert.equal((await call('A', '/api/users?op=update', { email: 'staff@netspace.vn', role: 'member' })).data.error.code, 'self');
    assert.equal((await call('A', '/api/users?op=update', { email: 'staff@netspace.vn', disabled: true })).data.error.code, 'self');
    assert.equal((await call('A', '/api/users?op=remove', { email: 'staff@netspace.vn' })).data.error.code, 'self');
    await call('A', '/api/users?op=update', { email: 'ctv@abc.com', role: 'admin' });
    assert.equal((await call('C', '/api/users?op=update', { email: 'staff@netspace.vn', disabled: true })).data.error.code, 'env_admin');
    assert.equal((await call('C', '/api/users?op=remove', { email: 'staff@netspace.vn' })).data.error.code, 'env_admin');
    assert.equal((await call('A', '/api/users?op=update', { email: 'ctv@abc.com', role: 'chu-tich' })).data.error.code, 'bad_role');
  });
  await t('cấp quyền cho email ngoài đã có tài khoản (sửa quyền) → đăng nhập được', async () => {
    assert.equal((await call('A', '/api/users?op=update', { email: 'outsider@gmail.com', role: 'member' })).status, 200);
    assert.equal((await login('O', 'outsider@gmail.com', USERS['outsider@gmail.com'])).status, 200);
  });
  await t('xóa tài khoản: mất quyền ngay, không đăng nhập lại được; audit/lead không bị đụng', async () => {
    const audits0 = f.db.audits.size;
    assert.equal((await call('A', '/api/users?op=remove', { email: 'partner@gmail.com' })).status, 200);
    assert.equal((await login('P7', 'partner@gmail.com', 'TamLan2-2026')).status, 401);
    assert.ok(!(await call('A', '/api/users')).data.users.some((x) => x.email === 'partner@gmail.com'));
    assert.equal((await call('A', '/api/users?op=remove', { email: 'partner@gmail.com' })).status, 404);
    assert.equal(f.db.audits.size, audits0);
  });
  await t('link mời đã hết hạn / sai → báo lỗi rõ, không tạo phiên', async () => {
    const r = await call('Z', '/api/me?op=setpw', { access_token: 'at_khong_ton_tai_1234567890', refresh_token: 'x', password: 'HopLe-2026abc' });
    assert.equal(r.status, 401); assert.equal(r.data.error.code, 'link_expired');
  });
} finally { server.close(); nt.server.close(); f.close && f.close(); }
console.log(ok ? 'Users: roles, invite links, temp passwords, disable, reset, delete, outside emails and safeguards passed.' : 'CÓ LỖI'); process.exit(ok ? 0 : 1);
