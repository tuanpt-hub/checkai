import assert from 'node:assert/strict';
import { startFakes, USERS } from './fakes.js';
import { startServer } from '../scripts/dev.js';
import { hashToken } from '../api/_lib/intake.js';

const f = await startFakes();
Object.assign(process.env, { SUPABASE_URL: `http://127.0.0.1:${f.ports.supabase}`, SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test', SUPABASE_SECRET_KEY: 'sb_secret_test', ALLOWED_EMAIL_DOMAINS: 'netspace.vn',
  ANTHROPIC_API_KEY: 'test-anthropic', ANTHROPIC_BASE_URL: `http://127.0.0.1:${f.ports.anthropic}`, COOKIE_INSECURE: '1', DAILY_CALL_LIMIT: '100', INTAKE_AI_LIMIT: '2', INTAKE_SUBMISSION_LIMIT: '3' });
delete process.env.AI_GATEWAY_API_KEY; delete process.env.OPENAI_API_KEY; delete process.env.GEMINI_API_KEY;
const server = await startServer(0), base = `http://127.0.0.1:${server.address().port}`;
try {
  const login = await fetch(base + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json', 'X-ABR': '1' }, body: JSON.stringify({ email: 'staff@netspace.vn', password: USERS['staff@netspace.vn'] }) });
  const cookie = login.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
  const team = async (path, method = 'GET', body) => { const r = await fetch(base + path, { method, headers: { Cookie: cookie, 'X-ABR': '1', 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, data: await r.json() }; };
  const pub = async (path, token, method = 'GET', body, extra = {}) => { const r = await fetch(base + path, { method, headers: { 'X-Intake-Token': token, 'Content-Type': 'application/json', ...extra }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, data: await r.json() }; };

  // audit phải có trên máy chủ
  assert.equal((await team('/api/intake-links', 'POST', { auditId: 'aud-intake', days: 7 })).status, 404);
  const data = { id: 'aud-intake', profile: { brand: 'NetSpace', category: 'truyền thông', market: 'Việt Nam' }, scores: { '1.1': { s: 3 } }, probe: { B1: { Claude: { code: 2 } } }, competitors: [{ name: 'Dinos', status: 'approved' }, { name: 'X', status: 'rejected' }] };
  assert.equal((await team('/api/audits/aud-intake', 'PUT', { data, base: null })).status, 200);
  // tạo link: token chỉ trả về một lần, lưu dạng băm
  assert.equal((await fetch(base + '/api/intake-links', { method: 'POST', headers: { 'X-ABR': '1', 'Content-Type': 'application/json' }, body: '{}' })).status, 401, 'creating links requires login');
  const mk = await team('/api/intake-links', 'POST', { auditId: 'aud-intake', days: 99 });
  assert.equal(mk.status, 200); const token = mk.data.token;
  assert.ok(token.length >= 40); assert.ok(Date.parse(mk.data.expiresAt) - Date.now() < 31 * 86400000, 'max 30 days');
  const stored = [...f.db.intake_links.values()][0];
  assert.equal(stored.token_hash, hashToken(token)); assert.ok(!JSON.stringify(stored).includes(token), 'raw token never stored');
  const list = await team('/api/intake-links?auditId=aud-intake'); assert.equal(list.data.links.length, 1); assert.ok(!JSON.stringify(list.data).includes(token), 'listing never returns token');
  // trang công khai: chỉ hồ sơ + đối thủ đã duyệt, không lộ điểm hay câu trả lời AI
  assert.equal((await pub('/api/intake', 'sai-token-sai-token-sai-token-xxxxx')).status, 401);
  assert.equal((await pub('/api/intake', '')).status, 401);
  const g = await pub('/api/intake', token); assert.equal(g.status, 200, JSON.stringify(g.data));
  assert.equal(g.data.fields.brand, 'NetSpace'); assert.deepEqual(g.data.competitors.map(c => c.name), ['Dinos']);
  const raw = JSON.stringify(g.data); assert.ok(!raw.includes('scores') && !raw.includes('probe') && !raw.includes('"s":3'));
  assert.equal((await pub('/api/intake', token, 'GET', null, { Origin: 'https://evil.example' })).status, 403);
  // gửi thông tin → hàng chờ
  assert.equal((await pub('/api/intake', token, 'POST', { fields: {} })).status, 400, 'empty submission rejected');
  const sub = await pub('/api/intake', token, 'POST', { fields: { oneliner: 'Định vị mới', legal: 'x'.repeat(5000), unknownField: 'bỏ qua' }, competitors: [{ name: 'Yeah1' }, { name: '' }], submitter: { name: 'Chị A', role: 'Marketing', email: 'lan@netspace.vn', phone: '0912 345 678' } });
  assert.equal(sub.status, 200, JSON.stringify(sub.data));
  const q = await team('/api/intake-submissions?auditId=aud-intake'); assert.equal(q.data.submissions.length, 1);
  const d = q.data.submissions[0].data; assert.equal(d.fields.oneliner, 'Định vị mới'); assert.equal(d.fields.legal.length, 300, 'field length capped');
  assert.ok(!('unknownField' in d.fields)); assert.deepEqual(d.competitors, [{ name: 'Yeah1', aliases: '' }]); assert.equal(d.submitter.name, 'Chị A'); assert.equal(d.submitter.email, 'lan@netspace.vn'); assert.equal(d.submitter.phone, '0912 345 678');
  for (const bad of [{ email: 'khong-phai-email' }, { phone: 'goi tôi' }, { phone: '12' }]) assert.equal((await pub('/api/intake', token, 'POST', { fields: { market: 'VN' }, submitter: bad })).status, 400, 'invalid contact rejected: ' + JSON.stringify(bad));
  const audit = await team('/api/audits/aud-intake'); assert.equal(audit.data.audit.profile.oneliner, undefined, 'submission must not touch the audit before review');
  assert.equal((await team('/api/intake-submissions', 'POST', { id: q.data.submissions[0].id, action: 'applied' })).status, 200);
  assert.equal((await team('/api/intake-submissions', 'POST', { id: q.data.submissions[0].id, action: 'rejected' })).status, 409, 'cannot review twice');
  assert.equal((await team('/api/intake-submissions?auditId=aud-intake')).data.submissions.length, 0);
  // giới hạn số lần gửi
  await pub('/api/intake', token, 'POST', { fields: { market: 'VN' } }); await pub('/api/intake', token, 'POST', { fields: { market: 'VN' } });
  assert.equal((await pub('/api/intake', token, 'POST', { fields: { market: 'VN' } })).status, 429, 'submission limit');
  // gợi ý bằng AI: giới hạn theo link, tính vào hạn mức người tạo link
  const ai1 = await pub('/api/intake-ai', token, 'POST', { kind: 'competitors', fields: { brand: 'NetSpace' } });
  assert.equal(ai1.status, 200, JSON.stringify(ai1.data)); assert.ok(ai1.data.items[0].name && ai1.data.items[0].reason); assert.equal(ai1.data.aiLeft, 1);
  const ai2 = await pub('/api/intake-ai', token, 'POST', { kind: 'topics', fields: {} }); assert.equal(ai2.data.items.length, 10);
  assert.equal((await pub('/api/intake-ai', token, 'POST', { kind: 'topics', fields: {} })).status, 429, 'AI limit per link');
  assert.equal((await pub('/api/intake-ai', token, 'POST', { kind: 'hack' })).status, 400);
  assert.ok([...f.db.usage.entries()].some(([k, v]) => k.startsWith('staff@netspace.vn') && v >= 2), 'AI cost charged to the link creator');
  // hết hạn và thu hồi
  stored.expires_at = new Date(Date.now() - 1000).toISOString();
  assert.equal((await pub('/api/intake', token)).status, 410, 'expired link');
  stored.expires_at = new Date(Date.now() + 86400000).toISOString();
  assert.equal((await team(`/api/intake-links?id=${stored.id}`, 'DELETE')).status, 200);
  assert.equal((await pub('/api/intake', token)).status, 410, 'revoked link');
  console.log('Intake: hashed one-time token, scoped public read, review queue, caps, expiry and revocation passed.');
} finally { server.close(); f.close(); }
