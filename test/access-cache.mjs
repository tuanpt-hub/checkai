// Tái hiện cuộc đua: một lần đọc quyền bắt đầu TRƯỚC khi xóa bộ đệm, kết thúc SAU – không được ghi đè trạng thái cũ.
import assert from 'node:assert/strict';
let release; const gate = new Promise((r) => (release = r)); let calls = 0, mustChange = true;
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  if (String(url).includes('/rest/v1/staff')) { calls++; const snap = mustChange; if (calls === 1) await gate; return new Response(JSON.stringify([{ email: 'a@b.vn', role: 'member', disabled: false, must_change: snap }]), { status: 200, headers: { 'content-type': 'application/json' } }); }
  return realFetch(url, init);
};
process.env.SUPABASE_URL = 'http://x'; process.env.SUPABASE_SECRET_KEY = 'sb_secret_x';
const { accessFor, clearAccessCache } = await import('../api/_lib/auth.js');
const slow = accessFor('a@b.vn');               // đọc cũ (must_change = true), đang chờ
mustChange = false; clearAccessCache('a@b.vn');  // đổi mật khẩu xong, xóa bộ đệm
release(); assert.equal((await slow).mustChange, true, 'the slow read itself saw old data');
assert.equal((await accessFor('a@b.vn')).mustChange, false, 'stale result must not be cached');
// Chưa có bảng staff (PostgREST 404 / PGRST205): không khóa cả nhóm, quay về allowlist theo tên miền.
mustChange = null;
globalThis.fetch = async (url) => String(url).includes('/rest/v1/staff') ? new Response(JSON.stringify({ code: 'PGRST205', message: "Could not find the table 'public.staff'" }), { status: 404, headers: { 'content-type': 'application/json' } }) : realFetch(url);
process.env.ALLOWED_EMAIL_DOMAINS = 'netspace.vn'; process.env.ADMIN_EMAILS = 'boss@netspace.vn'; clearAccessCache();
assert.equal((await accessFor('nv@netspace.vn')).allowed, true); assert.equal((await accessFor('boss@netspace.vn')).isAdmin, true); assert.equal((await accessFor('la@gmail.com')).allowed, false);
// Lỗi cơ sở dữ liệu khác: vẫn chặn (an toàn)
globalThis.fetch = async (url) => String(url).includes('/rest/v1/staff') ? new Response('{}', { status: 500 }) : realFetch(url); clearAccessCache();
await assert.rejects(accessFor('nv2@netspace.vn'), (e) => e.code === 'db_error');
console.log('Access cache: stale-read race, missing staff table fallback and fail-closed on other errors passed.');
