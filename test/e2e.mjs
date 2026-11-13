// Kiểm thử API đầu-cuối với máy chủ giả lập: npm test
import assert from 'node:assert/strict';
import { startFakes, calls, USERS } from './fakes.js';
import { startServer } from '../scripts/dev.js';

const f = await startFakes();
Object.assign(process.env, {
  SUPABASE_URL: `http://127.0.0.1:${f.ports.supabase}`,
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
  SUPABASE_SECRET_KEY: 'sb_secret_test',
  ALLOWED_EMAIL_DOMAINS: 'netspace.vn', ALLOWED_EMAILS: '',
  ANTHROPIC_API_KEY: 'test-anthropic', OPENAI_API_KEY: 'test-openai', GEMINI_API_KEY: 'test-gemini',
  ANTHROPIC_BASE_URL: `http://127.0.0.1:${f.ports.anthropic}`, OPENAI_BASE_URL: `http://127.0.0.1:${f.ports.openai}`, GEMINI_BASE_URL: `http://127.0.0.1:${f.ports.gemini}`,
  COOKIE_INSECURE: '1', DAILY_CALL_LIMIT: '12',
});
const server = await startServer(0);
const base = `http://127.0.0.1:${server.address().port}`;

let jar = {};
const cookieHeader = () => Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
async function api(path, { method = 'GET', body, csrf = true, noCookie = false, headers = {} } = {}) {
  const r = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(csrf ? { 'X-ABR': '1' } : {}), ...(noCookie ? {} : { Cookie: cookieHeader() }), ...headers }, body: body ? JSON.stringify(body) : undefined });
  for (const c of r.headers.getSetCookie?.() || []) { const [kv] = c.split(';'); const i = kv.indexOf('='); const k = kv.slice(0, i); const v = decodeURIComponent(kv.slice(i + 1)); if (/Max-Age=0/i.test(c)) delete jar[k]; else jar[k] = v; }
  let j = null; try { j = await r.json(); } catch { /* */ }
  return { status: r.status, json: j, headers: r.headers };
}
let n = 0; const t = (name, fn) => fn().then(() => console.log('  ✓', name)).catch((e) => { console.error('  ✗', name, '\n   ', e.message); process.exitCode = 1; });

console.log('Bảo mật & đăng nhập');
await t('chưa đăng nhập: /api/me, /api/probe, /api/claude, /api/audits đều 401', async () => {
  for (const [m, p, b] of [['GET', '/api/me'], ['POST', '/api/probe', { engine: 'claude', prompt: 'abc' }], ['POST', '/api/claude', { prompt: 'abc' }], ['GET', '/api/audits']]) {
    const r = await api(p, { method: m, body: b }); assert.equal(r.status, 401, p);
  }
  assert.equal(calls.anthropic + calls.openai + calls.gemini, 0, 'không được gọi AI khi chưa đăng nhập');
});
await t('thiếu header X-ABR (CSRF) bị chặn', async () => { const r = await api('/api/login', { method: 'POST', body: { email: 'staff@netspace.vn', password: 'x' }, csrf: false }); assert.equal(r.status, 403); });
await t('Origin lạ bị chặn', async () => { const r = await api('/api/login', { method: 'POST', body: { email: 'a@netspace.vn', password: 'x' }, headers: { Origin: 'https://evil.example' } }); assert.equal(r.status, 403); });
await t('sai mật khẩu → 401 thông báo chung', async () => { const r = await api('/api/login', { method: 'POST', body: { email: 'staff@netspace.vn', password: 'sai' } }); assert.equal(r.status, 401); assert.equal(r.json.error.code, 'invalid_credentials'); });
await t('email ngoài allowlist (đúng mật khẩu) vẫn bị từ chối và không gọi Supabase', async () => {
  const before = Object.keys(f.db.sessions).length; const r = await api('/api/login', { method: 'POST', body: { email: 'outsider@gmail.com', password: USERS['outsider@gmail.com'] } });
  assert.equal(r.status, 401); assert.equal(r.json.error.message.includes('chưa được cấp quyền'), true); assert.equal(jar.abr_at, undefined);
});
await t('đăng nhập đúng → cookie HttpOnly, /api/me hợp lệ', async () => {
  const r = await api('/api/login', { method: 'POST', body: { email: 'staff@netspace.vn', password: USERS['staff@netspace.vn'] } });
  assert.equal(r.status, 200); assert.ok(jar.abr_at && jar.abr_rt);
  const raw = r.headers.getSetCookie().join('\n'); assert.match(raw, /HttpOnly/); assert.match(raw, /SameSite=Strict/);
  const me = await api('/api/me'); assert.equal(me.status, 200); assert.equal(me.json.email, 'staff@netspace.vn');
  assert.deepEqual(me.json.engines, { claude: true, openai: true, gemini: true });
  assert.equal(JSON.stringify(me.json).includes('test-'), false, 'không lộ khóa API');
});
await t('hết access token → tự làm mới bằng refresh token', async () => { delete jar.abr_at; const me = await api('/api/me'); assert.equal(me.status, 200); assert.ok(jar.abr_at); });

console.log('Hỏi 3 AI');
for (const eng of ['claude', 'openai', 'gemini']) {
  await t(`probe ${eng}: có văn bản, nguồn trích dẫn, truy vấn tìm kiếm`, async () => {
    const r = await api('/api/probe', { method: 'POST', body: { engine: eng, prompt: 'NetSpace là công ty gì?', web: true } });
    assert.equal(r.status, 200, JSON.stringify(r.json)); assert.ok(r.json.text.length > 10); assert.ok(r.json.sources.length >= 1); assert.ok(r.json.queries.length >= 1);
    assert.equal(r.json.text.includes('Để tôi tìm kiếm'), false, 'phải bỏ lời dẫn trước khi tìm kiếm');
  });
}
await t('probe: engine/prompt sai → 400', async () => { assert.equal((await api('/api/probe', { method: 'POST', body: { engine: 'x', prompt: 'abcd' } })).status, 400); assert.equal((await api('/api/probe', { method: 'POST', body: { engine: 'claude', prompt: 'a' } })).status, 400); });
await t('claude: sinh JSON (bóc code fence) và văn bản', async () => {
  const j = await api('/api/claude', { method: 'POST', body: { prompt: 'Chỉ trả về JSON.\n[B1] Câu hỏi\n"knows"', json: true } });
  assert.equal(j.status, 200, JSON.stringify(j.json)); assert.ok(Array.isArray(j.json.json) && j.json.json[0].id === 'B1');
  const x = await api('/api/claude', { method: 'POST', body: { prompt: 'Viết tóm tắt' } }); assert.equal(x.status, 200); assert.ok(x.json.text.includes('giả lập'));
});
await t('hạn mức ngày: vượt DAILY_CALL_LIMIT → 429', async () => {
  let last; for (let i = 0; i < 12; i++) last = await api('/api/probe', { method: 'POST', body: { engine: 'gemini', prompt: 'NetSpace?' } });
  assert.equal(last.status, 429); assert.equal(last.json.error.code, 'daily_limit');
});

console.log('Lưu audit');
await t('tạo → đọc → sửa → xung đột phiên bản → xóa', async () => {
  const data = { id: 'aud_test1', profile: { brand: 'Test' }, scores: {}, probe: {} };
  let r = await api('/api/audits/aud_test1', { method: 'PUT', body: { data, base: null, meta: { brand: 'Test', score: 40, level: 'Phân mảnh' } } }); assert.equal(r.status, 200); assert.equal(r.json.version, 1);
  r = await api('/api/audits/aud_test1', { method: 'PUT', body: { data, base: null } }); assert.equal(r.status, 409);
  r = await api('/api/audits/aud_test1'); assert.equal(r.status, 200); assert.equal(r.json.audit.profile.brand, 'Test');
  r = await api('/api/audits/aud_test1', { method: 'PUT', body: { data: { ...data, x: 1 }, base: 1 } }); assert.equal(r.status, 200); assert.equal(r.json.version, 2);
  r = await api('/api/audits/aud_test1', { method: 'PUT', body: { data: { ...data, x: 2 }, base: 1 } }); assert.equal(r.status, 409); assert.equal(r.json.error.version, 2);
  r = await api('/api/audits'); assert.equal(r.json.audits.length, 1); assert.equal(r.json.audits[0].brand, 'Test');
  r = await api('/api/audits/aud_test1', { method: 'DELETE' }); assert.equal(r.status, 200);
  r = await api('/api/audits/aud_test1'); assert.equal(r.status, 404);
});
await t('mã audit không hợp lệ / dữ liệu sai → 400', async () => {
  assert.equal((await api('/api/audits/a%20b')).status, 400);
  assert.equal((await api('/api/audits/abc', { method: 'PUT', body: { data: { id: 'khac', profile: {} } } })).status, 400);
});
console.log('Đăng xuất');
await t('logout xóa cookie; sau đó 401', async () => { const r = await api('/api/logout', { method: 'POST' }); assert.equal(r.status, 200); assert.equal(jar.abr_at, undefined); assert.equal((await api('/api/me')).status, 401); });
await t('allowlist rỗng → đóng hoàn toàn', async () => {
  const keep = process.env.ALLOWED_EMAIL_DOMAINS; process.env.ALLOWED_EMAIL_DOMAINS = '';
  const r = await api('/api/login', { method: 'POST', body: { email: 'staff@netspace.vn', password: USERS['staff@netspace.vn'] } }); assert.equal(r.status, 401); process.env.ALLOWED_EMAIL_DOMAINS = keep;
});

server.close(); f.close();
console.log(process.exitCode ? '\nCÓ LỖI' : '\nTẤT CẢ ĐẠT');
