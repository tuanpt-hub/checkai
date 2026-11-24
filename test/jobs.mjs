import assert from 'node:assert/strict';
import { startFakes, USERS } from './fakes.js';
import { startServer } from '../scripts/dev.js';
import crypto from 'node:crypto';
import '../public/probe-core.js';

// Hàng đợi việc AI chạy nền: giao việc, chạy theo đợt và tự gọi đợt sau, chấm điểm, nhận kết quả một lần, dừng, chống trùng, khôi phục khi kẹt.
const f = await startFakes();
Object.assign(process.env, { SUPABASE_URL: `http://127.0.0.1:${f.ports.supabase}`, SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test', SUPABASE_SECRET_KEY: 'sb_secret_test', ALLOWED_EMAIL_DOMAINS: 'netspace.vn',
  ANTHROPIC_API_KEY: 'test-anthropic', OPENAI_API_KEY: 'test-openai', GEMINI_API_KEY: 'test-gemini', ANTHROPIC_BASE_URL: `http://127.0.0.1:${f.ports.anthropic}`, OPENAI_BASE_URL: `http://127.0.0.1:${f.ports.openai}`, GEMINI_BASE_URL: `http://127.0.0.1:${f.ports.gemini}`,
  COOKIE_INSECURE: '1', DAILY_CALL_LIMIT: '500', JOBS_SECRET: 'bi-mat-hang-doi-0123456789',
  // Đợt ngắn để buộc bộ chạy phải tự gọi đợt sau nhiều lần
  JOB_BUDGET_MS: '2500', JOB_MIN_LEFT_ASK_MS: '400', JOB_MIN_LEFT_GEN_MS: '400', JOB_CONCURRENCY: '2' });
delete process.env.AI_GATEWAY_API_KEY; delete process.env.VERCEL;
const server = await startServer(0), base = `http://127.0.0.1:${server.address().port}`;
process.env.APP_URL = base;
let cookie = '';
const call = async (path, body, headers = {}) => {
  const r = await fetch(base + path, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', 'X-ABR': '1', ...(cookie ? { Cookie: cookie } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
  let data = null; try { data = await r.json(); } catch { /* trống */ } return { status: r.status, data };
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitJob(id, ms = 30000) { const t0 = Date.now(); for (;;) { const j = (await call('/api/probe?op=get&id=' + id)).data.job; if (['done', 'failed', 'canceled'].includes(j.status)) return j; if (Date.now() - t0 > ms) throw new Error('quá thời gian, trạng thái ' + j.status + ' ' + JSON.stringify(j.summary)); await sleep(150); } }
const probeItems = (engines, n, extra = '') => engines.flatMap((e) => Array.from({ length: n }, (_, i) => ({ key: `B${i + 1}|${e}|0`, payload: { engine: e, prompt: `NetSpace là công ty gì? câu ${i + 1} ${extra}`, web: true, pid: 'B' + (i + 1), g: 'B', run: 0 } })));
const judge = { truth: 'Tên thương hiệu: NetSpace\nWebsite: netspace.vn', brand: 'NetSpace', base: 'claude-sonnet-5-5' };
let ok = true; const t = async (name, fn) => { try { await fn(); console.log('  ✓ ' + name); } catch (e) { ok = false; console.log('  ✗ ' + name + '\n    ' + String(e.message).split('\n').slice(0, 6).join('\n    ')); } };
try {
  await t('cần đăng nhập; đánh thức bộ chạy cần khóa bí mật hoặc đăng nhập', async () => {
    assert.equal((await call('/api/probe?op=create', { auditId: 'aud-1', kind: 'probe', items: [] })).status, 401);
    assert.equal((await call('/api/probe?op=tick', {})).status, 401);
    assert.equal((await call('/api/probe?op=tick', {}, { 'x-jobs-secret': 'sai-khoa-bi-mat-000000000' })).status, 401);
    assert.equal((await call('/api/probe?op=tick', {}, { 'x-jobs-secret': process.env.JOBS_SECRET })).status, 200);
    const l = await fetch(base + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json', 'X-ABR': '1' }, body: JSON.stringify({ email: 'staff@netspace.vn', password: USERS['staff@netspace.vn'] }) });
    cookie = l.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  });
  await t('kiểm tra đầu vào: loại việc, AI, câu hỏi, hồ sơ chuẩn, hạn mức hôm nay', async () => {
    assert.equal((await call('/api/probe?op=create', { auditId: 'aud-1', kind: 'xyz', items: probeItems(['claude'], 1) })).data.error.code, 'bad_kind');
    assert.equal((await call('/api/probe?op=create', { auditId: 'aud-1', kind: 'probe', items: [{ key: 'x', payload: { engine: 'skynet', prompt: 'abc' } }], params: { judge } })).data.error.code, 'bad_engine');
    assert.equal((await call('/api/probe?op=create', { auditId: 'aud-1', kind: 'probe', items: probeItems(['claude'], 1), params: { judge: { truth: '' } } })).data.error.code, 'bad_params');
    process.env.DAILY_CALL_LIMIT = '3';
    assert.equal((await call('/api/probe?op=create', { auditId: 'aud-1', kind: 'probe', items: probeItems(['claude', 'openai'], 2), params: { judge } })).data.error.code, 'daily_limit');
    process.env.DAILY_CALL_LIMIT = '500';
  });
  let jobId;
  await t('Hỏi AI chạy nền trọn vòng: 3 AI × 6 câu, đợt 2,5 giây buộc tự gọi đợt sau nhiều lần, rồi tự chấm', async () => {
    const claims0 = f.db.claims || 0;
    const r = await call('/api/probe?op=create', { auditId: 'aud-1', kind: 'probe', items: [...probeItems(['claude'], 6, '#CHAM'), ...probeItems(['openai', 'gemini'], 6)], params: { judge, label: 'Hỏi AI nhóm B', feature: 'probe' } });
    assert.equal(r.status, 200, JSON.stringify(r.data)); jobId = r.data.job.id; assert.equal(r.data.job.total, 18);
    const j = await waitJob(jobId);
    assert.equal(j.status, 'done', JSON.stringify(j)); assert.equal(j.done, 18); assert.ok(j.summary.judgeTotal >= 3); assert.equal(j.summary.judgeDone, j.summary.judgeTotal);
    assert.ok((f.db.claims || 0) - claims0 >= 2, 'nhận việc nhiều đợt (tự gọi đợt sau): ' + ((f.db.claims || 0) - claims0));
    const items = [...f.db.ai_job_items.values()].filter((x) => x.job_id === jobId);
    assert.equal(items.filter((x) => x.stage === 'ask' && x.status === 'done').length, 18);
    assert.ok(items.filter((x) => x.stage === 'judge').every((x) => x.status === 'done' && Array.isArray(x.result.json)), 'mọi lô chấm trả về JSON');
    assert.ok([...f.db.usage.values()].reduce((a, b) => a + b, 0) >= 18 + j.summary.judgeTotal, 'tính lượt dùng cho cả hỏi và chấm');
  });
  await t('nhận kết quả để gộp: chỉ một lần; trả lại được khi gộp lỗi', async () => {
    const r1 = await call('/api/probe?op=results', { id: jobId }); assert.equal(r1.status, 200);
    assert.equal(r1.data.items.filter((x) => x.stage === 'ask').length, 18); assert.ok(r1.data.items.find((x) => x.stage === 'ask').result.text.length > 0);
    const jd = r1.data.items.find((x) => x.stage === 'judge'); assert.ok(jd.payload.keys.length >= 1 && !jd.payload.items, 'không gửi lại toàn văn câu trả lời trong lô chấm');
    assert.equal((await call('/api/probe?op=results', { id: jobId })).data.error.code, 'already_applied');
    await call('/api/probe?op=unapply', { id: jobId }); assert.equal((await call('/api/probe?op=results', { id: jobId })).status, 200);
    const l = await call('/api/probe?op=list&auditId=aud-1'); assert.equal(l.data.jobs[0].id, jobId); assert.ok(l.data.jobs[0].appliedAt);
  });
  await t('chống chạy trùng: mỗi audit một việc Hỏi AI đang chạy', async () => {
    const a = await call('/api/probe?op=create', { auditId: 'aud-2', kind: 'probe', items: probeItems(['claude'], 6, '#CHAM'), params: { judge } }); assert.equal(a.status, 200);
    const b = await call('/api/probe?op=create', { auditId: 'aud-2', kind: 'probe', items: probeItems(['openai'], 1), params: { judge } });
    assert.equal(b.status, 409); assert.equal(b.data.error.code, 'job_running'); assert.equal(b.data.error.jobId, a.data.job.id);
    // Dừng: việc chuyển sang "đã dừng", bộ chạy ngừng gửi
    const c = await call('/api/probe?op=cancel', { id: a.data.job.id }); assert.equal(c.data.job.status, 'canceled');
    await sleep(2000); const j = (await call('/api/probe?op=get&id=' + a.data.job.id)).data.job; assert.equal(j.status, 'canceled'); assert.ok(j.done < 6, 'dừng giữa chừng, done=' + j.done);
    const after = [...f.db.ai_job_items.values()].filter((x) => x.job_id === a.data.job.id && x.status === 'done').length; await sleep(1500);
    assert.equal([...f.db.ai_job_items.values()].filter((x) => x.job_id === a.data.job.id && x.status === 'done').length, after, 'không gửi thêm sau khi dừng');
    assert.equal((await call('/api/probe?op=create', { auditId: 'aud-2', kind: 'probe', items: probeItems(['openai'], 1), params: { judge } })).status, 200, 'dừng xong thì giao việc mới được');
  });
  await t('AI lỗi nghiêm trọng (sai khóa) bị dừng gửi; các AI khác vẫn chạy và việc vẫn hoàn tất', async () => {
    const items = [...probeItems(['claude'], 5, '#AUTHFAIL'), ...probeItems(['openai'], 3)];
    const r = await call('/api/probe?op=create', { auditId: 'aud-3', kind: 'probe', items, params: { judge } }); const j = await waitJob(r.data.job.id);
    assert.equal(j.status, 'done'); assert.ok(j.summary.halted.includes('claude'));
    const it = [...f.db.ai_job_items.values()].filter((x) => x.job_id === j.id && x.stage === 'ask');
    assert.equal(it.filter((x) => x.payload.engine === 'openai' && x.status === 'done').length, 3);
    assert.ok(it.filter((x) => x.payload.engine === 'claude' && x.status === 'skipped').length >= 1, 'các câu còn lại của AI lỗi được bỏ qua, không tốn tiền');
    assert.ok(Object.keys(j.summary.errors).some((k) => k.startsWith('claude|')));
  });
  await t('lỗi tạm thời (quá tải 429): thử lại đúng một lần rồi thành công, không dừng AI đó', async () => {
    const r = await call('/api/probe?op=create', { auditId: 'aud-6', kind: 'probe', items: probeItems(['claude'], 3, '#TAMTHOI'), params: { judge } });
    const j = await waitJob(r.data.job.id); assert.equal(j.status, 'done'); assert.ok(!j.summary.halted.includes('claude'));
    const it = [...f.db.ai_job_items.values()].filter((x) => x.job_id === j.id && x.stage === 'ask');
    assert.equal(it.filter((x) => x.status === 'done').length, 3, 'cả 3 câu hoàn tất dù lần gọi đầu bị 429');
    assert.ok(it.every((x) => !x.error || x.attempts <= 1), 'không thử lại quá một lần ở bộ chạy');
  });
  await t('khôi phục khi máy chủ tắt giữa chừng: lượt kẹt "đang chạy" được xếp lại, khóa hết hạn thì máy chủ khác nhận tiếp', async () => {
    const id = crypto.randomUUID(), old = new Date(Date.now() - 10 * 60_000).toISOString();
    f.db.ai_jobs.set(id, { id, audit_id: 'aud-4', kind: 'probe', status: 'running', stage: 'ask', created_by: 'staff@netspace.vn', created_at: new Date().toISOString(), params: { judge }, total: 3, done: 0, summary: {}, lock_until: new Date(Date.now() + 60_000).toISOString(), applied_at: null });
    for (const it of probeItems(['gemini'], 3)) { const iid = crypto.randomUUID(); f.db.ai_job_items.set(iid, { id: iid, job_id: id, stage: 'ask', key: it.key, payload: it.payload, status: 'running', attempts: 0, updated_at: old, result: null }); }
    await call('/api/probe?op=tick', {}, { 'x-jobs-secret': process.env.JOBS_SECRET }); await sleep(800);
    assert.equal(f.db.ai_jobs.get(id).done, 0, 'khóa còn hạn (máy chủ khác đang giữ): không ai được nhận');
    f.db.ai_jobs.get(id).lock_until = new Date(Date.now() - 1000).toISOString();
    await call('/api/probe?op=tick', {}, { 'x-jobs-secret': process.env.JOBS_SECRET });
    const j = await waitJob(id); assert.equal(j.status, 'done'); assert.equal(j.done, 3, 'cả 3 lượt kẹt được chạy lại');
  });
  await t('loại việc "soạn/chấm" (dùng cho giai đoạn 2 và 3): JSON và văn bản', async () => {
    const r = await call('/api/probe?op=create', { auditId: 'aud-5', kind: 'gen', items: [{ key: 'a', payload: { prompt: globalThis.CheckAIProbe.judgePrompt(judge, 'B', [{ id: 'B1', q: 'NetSpace là gì?', a: 'NetSpace là công ty truyền thông.' }]), json: true } }, { key: 'b', payload: { prompt: 'Viết một câu giới thiệu NetSpace.', json: false } }], params: { feature: 'test' } });
    assert.equal(r.status, 200, JSON.stringify(r.data)); const j = await waitJob(r.data.job.id); assert.equal(j.status, 'done'); assert.equal(j.done, 2);
    const res = (await call('/api/probe?op=results', { id: j.id })).data.items; assert.ok(Array.isArray(res.find((x) => x.key === 'a').result.json)); assert.ok(res.find((x) => x.key === 'b').result.text.length > 0);
  });
  await t('hỏi nhanh một câu (đường cũ) vẫn chạy', async () => {
    const r = await call('/api/probe', { engine: 'claude', prompt: 'NetSpace là công ty gì?' }); assert.equal(r.status, 200); assert.ok(r.data.text);
  });
} finally { server.close(); f.close(); }
console.log(ok ? 'Jobs: background queue, chaining, judging, apply-once, cancel, de-dup, fatal halting, stuck recovery and gen kind passed.' : 'CÓ LỖI'); process.exit(ok ? 0 : 1);
