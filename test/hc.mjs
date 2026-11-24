import assert from 'node:assert/strict';
import { startFakes, startFakeSite, startFakeNotify, USERS } from './fakes.js';
import { startServer } from '../scripts/dev.js';

// AI Health Check tự phục vụ + biểu mẫu tư vấn + khách tiềm năng (đợt A).
const f = await startFakes(), site = await startFakeSite(0), nt = await startFakeNotify();
const sitePort = site.address().port;
Object.assign(process.env, { SUPABASE_URL: `http://127.0.0.1:${f.ports.supabase}`, SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test', SUPABASE_SECRET_KEY: 'sb_secret_test', ALLOWED_EMAIL_DOMAINS: 'netspace.vn',
  ANTHROPIC_API_KEY: 'test-anthropic', OPENAI_API_KEY: 'test-openai', GEMINI_API_KEY: 'test-gemini', ANTHROPIC_BASE_URL: `http://127.0.0.1:${f.ports.anthropic}`, OPENAI_BASE_URL: `http://127.0.0.1:${f.ports.openai}`, GEMINI_BASE_URL: `http://127.0.0.1:${f.ports.gemini}`,
  COOKIE_INSECURE: '1', SCAN_ALLOW_PRIVATE: '1', DAILY_CALL_LIMIT: '500', HC_DAILY_LIMIT: '2', TURNSTILE_SECRET_KEY: 'test-turnstile-secret', TURNSTILE_SITE_KEY: '0x-site-key',
  SITE_URL: 'https://brand.ai.vn', APP_URL: 'https://app.brand.ai.vn', ...nt.env });
delete process.env.AI_GATEWAY_API_KEY; delete process.env.VERCEL;
const server = await startServer(0), base = `http://127.0.0.1:${server.address().port}`;
const call = async (path, body, headers = {}) => { const r = await fetch(base + path, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, data: await r.json() }; };
const lastLink = () => { const e = nt.sent.emails.at(-1); const m = e && e.text.match(/#v=([A-Za-z0-9_-]+)/); return m && m[1]; };
let ok = true; const t = async (name, fn) => { try { await fn(); console.log('  ✓ ' + name); } catch (e) { ok = false; console.log('  ✗ ' + name + '\n    ' + String(e.message).split('\n').slice(0, 6).join('\n    ')); } };
try {
  const form = { brand: 'NetSpace', website: `http://127.0.0.1:${sitePort}`, email: 'khach@congty.vn', name: 'Chị Lan', consent: true, turnstile: 'ok-token', utm: { utm_source: 'chatgpt', utm_campaign: 'ra-mat' }, referrer: 'https://chatgpt.com/' };
  let session, reportUrl;
  await t('config: khóa site Turnstile và AI sẽ hỏi', async () => {
    const r = await call('/api/hc'); assert.equal(r.status, 200); assert.equal(r.data.turnstileSiteKey, '0x-site-key'); assert.deepEqual(r.data.engines.map((e) => e.id), ['claude', 'openai', 'gemini']); assert.equal(r.data.open, true);
  });
  await t('start: thiếu đồng ý, sai captcha, sai email đều bị chặn', async () => {
    assert.equal((await call('/api/hc?op=start', { ...form, consent: false })).data.error.code, 'consent_required');
    assert.equal((await call('/api/hc?op=start', { ...form, turnstile: 'sai' })).data.error.code, 'captcha_failed');
    assert.equal((await call('/api/hc?op=start', { ...form, email: 'khong-phai-email' })).data.error.code, 'bad_email');
    assert.equal((await call('/api/hc?op=start', form, { Origin: 'https://trang-la.example' })).status, 403, 'cross-site post blocked');
    assert.equal(f.db.health_checks.size, 0);
  });
  await t('start: tạo lead + phiên chờ xác minh, gửi email có link, không lưu token gốc', async () => {
    const r = await call('/api/hc?op=start', form); assert.equal(r.status, 200, JSON.stringify(r.data)); assert.equal(r.data.emailSent, true); assert.equal(r.data.devVerifyUrl, undefined);
    const mail = nt.sent.emails.at(-1); assert.deepEqual(mail.to, ['khach@congty.vn']); assert.match(mail.text, /https:\/\/brand\.ai\.vn\/kiem-tra#v=/);
    const tok = lastLink(); const hc = [...f.db.health_checks.values()][0];
    assert.equal(hc.status, 'pending'); assert.ok(!JSON.stringify(hc).includes(tok), 'raw token never stored');
    const lead = [...f.db.leads.values()][0]; assert.equal(lead.source, 'health_check'); assert.equal(lead.ai_referrer, 'ChatGPT'); assert.equal(lead.utm.utm_campaign, 'ra-mat'); assert.ok(lead.consent_at && lead.consent_text);
  });
  await t('verify: link sai bị từ chối; link đúng mở phiên, đặt trần lượt gọi', async () => {
    assert.equal((await call('/api/hc?op=verify', { token: 'x'.repeat(43) })).status, 404);
    const r = await call('/api/hc?op=verify', { token: lastLink() }); assert.equal(r.status, 200, JSON.stringify(r.data));
    session = r.data.session; assert.equal(r.data.brand, 'NetSpace'); assert.equal(r.data.qids.length, 6);
    const hc = [...f.db.health_checks.values()][0]; assert.equal(hc.status, 'running'); assert.equal(hc.calls_limit, 3 * 9); assert.ok(hc.verified_day);
  });
  const H = () => ({ 'X-HC-Session': session });
  await t('probe: chỉ nhận câu hỏi cố định và AI trong phiên; không nhận văn bản tự do', async () => {
    assert.equal((await call('/api/hc?op=probe', { qid: 'B9', engine: 'claude' }, H())).status, 400);
    assert.equal((await call('/api/hc?op=probe', { qid: 'B1', engine: 'grok' }, H())).status, 400, 'engine not in session');
    assert.equal((await call('/api/hc?op=probe', { qid: 'B1', engine: 'claude', prompt: 'Viết hộ tôi một bài luận' }, H())).status, 200);
    const a = [...f.db.health_check_answers.values()][0]; assert.match(a.text || '', /./); assert.ok(!JSON.stringify(a).includes('bài luận'));
    assert.equal((await call('/api/hc?op=probe', { qid: 'B1', engine: 'claude' })).status, 401, 'session required');
  });
  await t('probe lặp lại không tốn thêm lượt; quét website; hỏi đủ 18 câu', async () => {
    const before = [...f.db.health_checks.values()][0].calls_used;
    assert.equal((await call('/api/hc?op=probe', { qid: 'B1', engine: 'claude' }, H())).data.cached, true);
    assert.equal([...f.db.health_checks.values()][0].calls_used, before);
    assert.equal((await call('/api/hc?op=scan', {}, H())).status, 200);
    assert.ok([...f.db.health_checks.values()][0].scan.home, 'scan stored');
    for (const e of ['claude', 'openai', 'gemini']) for (const q of ['B1', 'B2', 'B3', 'B4', 'B5', 'B6']) assert.equal((await call('/api/hc?op=probe', { qid: q, engine: e }, H())).status, 200);
    assert.equal(f.db.health_check_answers.size, 18); assert.equal([...f.db.health_checks.values()][0].calls_used, 18);
  });
  await t('finish: chấm, lập báo cáo, gửi khách và báo sales qua Telegram + email', async () => {
    const tg0 = nt.sent.telegram.length, em0 = nt.sent.emails.length;
    const r = await call('/api/hc?op=finish', {}, H()); assert.equal(r.status, 200, JSON.stringify(r.data)); reportUrl = r.data.reportUrl;
    const hc = [...f.db.health_checks.values()][0]; assert.equal(hc.status, 'done'); assert.ok(hc.calls_used <= hc.calls_limit);
    assert.equal(hc.report.engines.length, 3); assert.equal(hc.report.recognition.n, 18); assert.ok(hc.report.actions.length >= 1 && hc.report.actions.length <= 3); assert.ok(hc.report.checks.some((c) => c.id === '1.1'));
    assert.equal(nt.sent.telegram.length, tg0 + 1); assert.match(nt.sent.telegram.at(-1).text, /AI Health Check xong: NetSpace/); assert.equal(nt.sent.telegram.at(-1).chat_id, '-100123');
    const mails = nt.sent.emails.slice(em0); assert.ok(mails.some((m) => m.to[0] === 'khach@congty.vn' && /brand\.ai\.vn\/r\//.test(m.text))); assert.ok(mails.some((m) => m.to[0] === 'sales@netspace.vn'));
    assert.equal([...f.db.leads.values()][0].status, 'health_check');
    assert.equal((await call('/api/hc?op=probe', { qid: 'B1', engine: 'claude' }, H())).status, 401, 'session closed after finish');
  });
  await t('report: xem công khai bằng mã riêng, không lộ email khách', async () => {
    const tok = reportUrl.split('/').pop(); const r = await call('/api/hc?op=report&t=' + tok); assert.equal(r.status, 200);
    assert.equal(r.data.brand, 'NetSpace'); assert.ok(!JSON.stringify(r.data).includes('khach@congty.vn'));
    assert.equal((await call('/api/hc?op=report&t=' + 'y'.repeat(43))).status, 404);
    const firstTok = nt.sent.emails.map((m) => (m.text.match(/#v=([A-Za-z0-9_-]+)/) || [])[1]).find(Boolean);
    const again = await call('/api/hc?op=verify', { token: firstTok }); assert.equal(again.status, 200, JSON.stringify(again.data));
    assert.equal(again.data.done, true); assert.equal(again.data.reportUrl, reportUrl);
  });
  await t('giới hạn đăng ký theo IP: lượt thứ 6 trong 10 phút bị chặn', async () => {
    let last; for (let i = 0; i < 6; i++) last = await call('/api/hc?op=start', { ...form, email: `ip${i}@congty.vn`, consent: false }, { 'X-Forwarded-For': '10.9.9.9' });
    assert.equal(last.status, 429); assert.equal(last.data.error.code, 'too_many_requests');
  });
  await t('cùng tên miền trong 30 ngày bị chặn; trần mỗi ngày', async () => {
    assert.equal((await call('/api/hc?op=start', { ...form, email: 'nguoi-khac@congty.vn' }, { 'X-Forwarded-For': '10.0.0.2' })).data.error.code, 'recent_check');
    const r2 = await call('/api/hc?op=start', { ...form, website: 'http://localhost:' + sitePort, email: 'b@congty.vn' }, { 'X-Forwarded-For': '10.0.0.3' }); assert.equal(r2.status, 200, JSON.stringify(r2.data));
    assert.equal((await call('/api/hc?op=verify', { token: lastLink() })).status, 200, 'second check today still under cap 2');
    const r3 = await call('/api/hc?op=start', { ...form, website: 'https://vi-du-thu-ba.vn', email: 'c@congty.vn' }, { 'X-Forwarded-For': '10.0.0.4' }); assert.equal(r3.status, 200);
    const v3 = await call('/api/hc?op=verify', { token: lastLink() }); assert.equal(v3.status, 429); assert.equal(v3.data.error.code, 'daily_cap');
  });
  await t('đặt lịch tư vấn: lưu lead, báo sales', async () => {
    const tg0 = nt.sent.telegram.length;
    const bad = await call('/api/hc?op=lead', { name: 'Anh Minh', email: 'minh@abc.vn', consent: true, turnstile: 'ok-token', phone: 'abc' }); assert.equal(bad.data.error.code, 'bad_phone');
    const r = await call('/api/hc?op=lead', { name: 'Anh Minh', title: 'CMO', company: 'Công ty ABC', email: 'minh@abc.vn', phone: '0912 345 678', package: 'AI Brand Audit', note: 'Cần audit trước Tết', consent: true, turnstile: 'ok-token' });
    assert.equal(r.status, 200, JSON.stringify(r.data)); assert.equal(nt.sent.telegram.length, tg0 + 1); assert.match(nt.sent.telegram.at(-1).text, /Công ty ABC/);
    assert.ok(/<b>Lead mới/.test(nt.sent.telegram.at(-1).text) && !/<script/.test(nt.sent.telegram.at(-1).text));
  });
  await t('khách tiềm năng (nội bộ): cần đăng nhập; danh sách kèm Health Check; đổi trạng thái, gắn audit', async () => {
    assert.equal((await call('/api/leads', null, { 'X-ABR': '1' })).status, 401);
    const login = await fetch(base + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json', 'X-ABR': '1' }, body: JSON.stringify({ email: 'staff@netspace.vn', password: USERS['staff@netspace.vn'] }) });
    const cookie = login.headers.getSetCookie().map((c) => c.split(';')[0]).join('; '); const S = { Cookie: cookie, 'X-ABR': '1' };
    const l = await call('/api/leads', null, S); assert.equal(l.status, 200); assert.equal(l.data.leads.length, 4);
    const withHc = l.data.leads.find((x) => x.hc && x.hc.status === 'done'); assert.ok(withHc.hc.reportUrl.startsWith('https://brand.ai.vn/r/')); assert.ok(!('ip_hash' in withHc));
    const u = await call('/api/leads?op=update', { id: withHc.id, status: 'audit', audit_id: 'aud-tu-lead', staff_note: 'Đã gọi, hẹn demo' }, S);
    assert.equal(u.status, 200); assert.equal(u.data.lead.status, 'audit'); assert.equal(u.data.lead.updated_by, 'staff@netspace.vn');
    assert.equal((await call('/api/leads?op=update', { id: withHc.id, status: 'bay-ba' }, S)).status, 400);
    assert.equal((await call('/api/leads?status=audit', null, S)).data.leads.length, 1);
  });
  // ---------- Đợt B ----------
  const repTok = () => reportUrl.split('/').pop();
  const hcRow = () => [...f.db.health_checks.values()].find((h) => h.report_token === repTok());
  await t('lượt xem: lần đầu báo Telegram; mở lại trong 30 phút không tính; người khác tính; nội bộ (nv=1) không tính', async () => {
    assert.ok(Date.parse(hcRow().report_expires_at) - Date.now() > 29 * 86400_000, 'expires in 30 days');
    const tg0 = nt.sent.telegram.length; hcRow().view_count = 0; f.db.report_views = []; hcRow().first_viewed_at = null;
    const ua = { 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile', 'X-Forwarded-For': '10.1.1.1' };
    const r1 = await call('/api/hc?op=report&t=' + repTok(), null, ua); assert.equal(r1.status, 200); assert.ok(r1.data.expiresAt);
    assert.equal(hcRow().view_count, 1); assert.equal(nt.sent.telegram.length, tg0 + 1); assert.match(nt.sent.telegram.at(-1).text, /mở báo cáo lần đầu: NetSpace/); assert.match(nt.sent.telegram.at(-1).text, /điện thoại/);
    await call('/api/hc?op=report&t=' + repTok(), null, ua); assert.equal(hcRow().view_count, 1, 'reload within 30 min not counted');
    await call('/api/hc?op=report&t=' + repTok(), null, { 'X-Forwarded-For': '10.1.1.2' }); assert.equal(hcRow().view_count, 2); assert.equal(nt.sent.telegram.length, tg0 + 1, 'only first view alerts');
    await call('/api/hc?op=report&t=' + repTok() + '&nv=1', null, { 'X-Forwarded-For': '10.1.1.3' }); assert.equal(hcRow().view_count, 2, 'staff view not counted');
    assert.ok(hcRow().first_viewed_at && hcRow().last_viewed_at);
  });
  await t('trang /r/<mã> có thẻ xem trước mang tên thương hiệu; không tính lượt xem; ảnh PNG 1200×630', async () => {
    const before = hcRow().view_count;
    const pg = await fetch(base + '/api/hc?op=page&t=' + repTok()); const html = await pg.text();
    assert.equal(pg.status, 200); assert.match(html, /<meta property="og:title" content="Kết quả AI Health Check: NetSpace">/); assert.match(html, /og:image" content="https:\/\/brand\.ai\.vn\/api\/hc\?op=og&amp;t=/);
    assert.match(html, /noindex/); assert.ok(!html.includes('khach@congty.vn')); assert.equal(hcRow().view_count, before);
    const img = await fetch(base + '/api/hc?op=og&t=' + repTok()); const buf = Buffer.from(await img.arrayBuffer());
    assert.equal(img.headers.get('content-type'), 'image/png'); assert.equal(buf.subarray(1, 4).toString(), 'PNG'); assert.equal(buf.readUInt32BE(16), 1200); assert.equal(buf.readUInt32BE(20), 630);
    { const g = await fetch(base + '/api/hc?op=og'); assert.equal(g.status, 200); assert.equal(g.headers.get('content-type'), 'image/png'); }
    const bad = await fetch(base + '/api/hc?op=page&t=' + 'z'.repeat(43)); assert.equal(bad.status, 200); assert.match(await bad.text(), /og:title" content="Kết quả AI Health Check – brand\.ai\.vn"/);
  });
  await t('hết hạn, thu hồi, gia hạn, mở lại (nội bộ)', async () => {
    const login = await fetch(base + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json', 'X-ABR': '1' }, body: JSON.stringify({ email: 'staff@netspace.vn', password: USERS['staff@netspace.vn'] }) });
    const S = { Cookie: login.headers.getSetCookie().map((c) => c.split(';')[0]).join('; '), 'X-ABR': '1' };
    const leadId = hcRow().lead_id;
    hcRow().report_expires_at = new Date(Date.now() - 1000).toISOString();
    const ex = await call('/api/hc?op=report&t=' + repTok(), null, { 'X-Forwarded-For': '10.2.2.2' }); assert.equal(ex.status, 410); assert.equal(ex.data.error.code, 'report_expired'); assert.match(ex.data.error.message, /hết hạn/);
    const pg = await (await fetch(base + '/api/hc?op=page&t=' + repTok())).text(); assert.ok(!pg.includes('Kết quả AI Health Check: NetSpace'), 'expired page shows no brand in preview');
    assert.equal((await call('/api/leads?op=report', { id: leadId, action: 'extend' }, { 'X-ABR': '1' })).status, 401, 'requires login'); assert.equal((await call('/api/leads?op=report', { id: leadId, action: 'extend' })).status, 403, 'csrf header required');
    const e1 = await call('/api/leads?op=report', { id: leadId, action: 'extend' }, S); assert.equal(e1.status, 200); assert.ok(Date.parse(e1.data.expiresAt) - Date.now() > 29 * 86400_000);
    assert.equal((await call('/api/hc?op=report&t=' + repTok() + '&nv=1')).status, 200);
    const rv = await call('/api/leads?op=report', { id: leadId, action: 'revoke' }, S); assert.equal(rv.data.revoked, true);
    const r2 = await call('/api/hc?op=report&t=' + repTok() + '&nv=1'); assert.equal(r2.status, 410); assert.match(r2.data.error.message, /thu hồi/);
    assert.equal((await call('/api/leads?op=report', { id: leadId, action: 'restore' }, S)).data.revoked, false);
    assert.equal((await call('/api/hc?op=report&t=' + repTok() + '&nv=1')).status, 200);
    assert.equal((await call('/api/leads?op=report', { id: leadId, action: 'xoa' }, S)).status, 400);
    const l = (await call('/api/leads', null, S)).data.leads.find((x) => x.id === leadId); assert.equal(l.hc.views, 2); assert.ok(l.hc.expiresAt); assert.equal(l.hc.revoked, false);
  });
  await t('xóa khách tiềm năng: chỉ quản trị viên; xóa kèm Health Check, câu trả lời, lượt xem', async () => {
    const login = await fetch(base + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json', 'X-ABR': '1' }, body: JSON.stringify({ email: 'staff@netspace.vn', password: USERS['staff@netspace.vn'] }) });
    const S = { Cookie: login.headers.getSetCookie().map((c) => c.split(';')[0]).join('; '), 'X-ABR': '1' };
    const target = [...f.db.health_checks.values()].find((h) => h.report_token === repTok()), leadId = target.lead_id, hcId = target.id;
    assert.ok([...f.db.health_check_answers.values()].some((a) => a.hc_id === hcId), 'has answers before');
    delete process.env.ADMIN_EMAILS;
    assert.equal((await call('/api/me', null, S)).data.isAdmin, false, 'no ADMIN_EMAILS → nobody is admin');
    assert.equal((await call('/api/leads?op=remove', { id: leadId }, S)).status, 403);
    process.env.ADMIN_EMAILS = 'boss@netspace.vn';
    const r403 = await call('/api/leads?op=remove', { id: leadId }, S); assert.equal(r403.status, 403); assert.equal(r403.data.error.code, 'not_admin');
    assert.ok(f.db.leads.has(leadId), 'nothing deleted by non-admin');
    process.env.ADMIN_EMAILS = 'boss@netspace.vn, Staff@NetSpace.vn';
    assert.equal((await call('/api/me', null, S)).data.isAdmin, true, 'case-insensitive list');
    assert.equal((await call('/api/leads?op=remove', { id: 'khong-phai-uuid' }, S)).status, 400);
    const ok1 = await call('/api/leads?op=remove', { id: leadId }, S); assert.equal(ok1.status, 200, JSON.stringify(ok1.data)); assert.equal(ok1.data.healthChecks, 1);
    assert.ok(!f.db.leads.has(leadId)); assert.ok(!f.db.health_checks.has(hcId));
    assert.ok(![...f.db.health_check_answers.values()].some((a) => a.hc_id === hcId), 'answers cascade');
    assert.equal((await call('/api/hc?op=report&t=' + repTok())).status, 404, 'report link dead');
    assert.equal((await call('/api/leads?op=remove', { id: leadId }, S)).status, 404);
    assert.equal((await call('/api/leads?op=remove', { id: leadId })).status, 403, 'csrf header required');
    delete process.env.ADMIN_EMAILS;
  });
  await t('định tuyến theo tên miền: brand.ai.vn ra landing, tên miền khác ra công cụ', async () => {
    const http = await import('node:http');
    const get = (path, host) => new Promise((res) => http.get({ host: '127.0.0.1', port: server.address().port, path, headers: { Host: host } }, (r) => { let d = ''; r.on('data', (c) => (d += c)); r.on('end', () => res({ status: r.statusCode, body: d })); }));
    assert.match((await get('/', 'brand.ai.vn')).body, /brand\.ai\.vn/); assert.doesNotMatch((await get('/', 'brand.ai.vn')).body, /id="login"/);
    assert.match((await get('/', 'app.brand.ai.vn')).body, /id="login"/);
    assert.match((await get('/robots.txt', 'brand.ai.vn')).body, /Allow: \//); assert.match((await get('/robots.txt', 'app.brand.ai.vn')).body, /Disallow: \//);
    const hs = await get('/ho-so', 'brand.ai.vn'); assert.equal(hs.status, 200); assert.match(hs.body, /Hồ sơ thương hiệu – brand\.ai\.vn/); assert.match(hs.body, /noindex/);
    assert.equal((await get('/intake', 'brand.ai.vn')).status, 200, 'old /intake path still works');
    const { intakeBase } = await import('../api/_lib/op-me.js'); assert.equal(intakeBase(), 'https://brand.ai.vn/ho-so');
    assert.match((await get('/r/abc', 'brand.ai.vn')).body, /noindex/); assert.match((await get('/r/' + repTok(), 'brand.ai.vn')).body, /og:title/); assert.match((await get('/kiem-tra', 'brand.ai.vn')).body, /Health Check/);
  });
} finally { server.close(); site.close(); nt.server.close(); }
console.log(ok ? 'AI Health Check, leads, notifications, report views/expiry/preview and host routing passed.' : 'CÓ LỖI'); process.exit(ok ? 0 : 1);
