import crypto from 'node:crypto';
import { waitUntil } from '@vercel/functions';
import { route, ok, allowMethods, readJson, HttpError, envInt } from './util.js';
import { requireUser } from './auth.js';
import { rest, rpc } from './supabase.js';
import { ask, configured, PROBE_SYSTEM, MODELS } from './providers.js';
import { selectedModel } from './model-options.js';
import { bump, dailyLimit, getUsage } from './usage.js';
import { judgeOrWrite } from './judge.js';
import { appUrl } from './notify.js';
import '../../public/probe-core.js';

/* ===== Hàng đợi việc AI chạy nền =====
   Trình duyệt giao việc rồi có thể đóng tab. Máy chủ chạy theo đợt (JOB_BUDGET_MS), hết đợt thì tự gọi đợt sau;
   Supabase pg_cron đánh thức mỗi phút phòng khi chuỗi tự gọi bị đứt. Kết quả nằm ở ai_job_items, trình duyệt gộp vào audit. */
export const ENGINES = ['claude', 'openai', 'gemini', 'grok', 'deepseek'];
export const PROBE_MAX_TOKENS = { claude: 1500, openai: 4000, gemini: 4096, grok: 3000, deepseek: 4000 };
const KINDS = ['probe', 'gen'];
const FATAL = ['auth_failed', 'insufficient_credit', 'model_not_found', 'bad_request', 'bad_model', 'not_configured', 'provider_unavailable', 'invalid_api_response'];
const RETRY = ['rate_limited', 'timeout', 'provider_error', 'empty_response', 'network'];
const budgetMs = () => envInt('JOB_BUDGET_MS', 240_000);
const lockSecs = () => Math.ceil(budgetMs() / 1000) + 60;
const CONC = () => envInt('JOB_CONCURRENCY', 4);
const MAX_ITEMS = 3000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const nowIso = () => new Date().toISOString();
const rows = (r, msg) => { if (r.status >= 300 || !Array.isArray(r.json)) throw new HttpError(502, 'db_error', msg || 'Lỗi cơ sở dữ liệu hàng đợi. Kiểm tra đã chạy SQL 007 chưa.'); return r.json; };
const s = (v, n) => String(v ?? '').slice(0, n);

/* ---------- giao việc ---------- */
function cleanProbeItem(it) {
  const p = it && it.payload || {};
  const engine = String(p.engine || '');
  if (!ENGINES.includes(engine)) throw new HttpError(400, 'bad_engine', 'AI không được hỗ trợ.');
  if (!configured()[engine]) throw new HttpError(503, 'not_configured', `${engine} chưa được cấu hình khóa API.`);
  const prompt = String(p.prompt || '').trim();
  if (prompt.length < 3 || prompt.length > 2000) throw new HttpError(400, 'bad_prompt', 'Câu hỏi phải dài 3–2000 ký tự.');
  return { key: s(it.key, 120), payload: { engine, prompt, web: p.web !== false, model: selectedModel(engine, p.model, MODELS()), pid: s(p.pid, 40), g: s(p.g, 4), run: Number(p.run) || 0 } };
}
function cleanGenItem(it) {
  const p = it && it.payload || {};
  const prompt = String(p.prompt || '');
  if (prompt.length < 3 || prompt.length > 120_000) throw new HttpError(400, 'bad_prompt', 'Nội dung quá ngắn hoặc quá dài.');
  return { key: s(it.key, 120), payload: { prompt, json: !!p.json, model: selectedModel('judge', p.model, MODELS()), maxTokens: Math.min(Math.max(parseInt(p.maxTokens, 10) || 2000, 200), 6000), meta: p.meta && typeof p.meta === 'object' ? p.meta : null } };
}

export const create = route(async (req, res) => {
  allowMethods(req, ['POST']);
  const user = await requireUser(req, res);
  const b = await readJson(req, 2_000_000);
  const auditId = s(b.auditId, 64), kind = String(b.kind || '');
  if (!/^[A-Za-z0-9_-]{3,64}$/.test(auditId)) throw new HttpError(400, 'bad_audit', 'Mã audit không hợp lệ.');
  if (!KINDS.includes(kind)) throw new HttpError(400, 'bad_kind', 'Loại việc không hợp lệ.');
  const items = Array.isArray(b.items) ? b.items : [];
  if (!items.length || items.length > MAX_ITEMS) throw new HttpError(400, 'bad_items', `Cần 1–${MAX_ITEMS} lượt gọi.`);
  const clean = items.map(kind === 'probe' ? cleanProbeItem : cleanGenItem);
  if (new Set(clean.map((x) => x.key)).size !== clean.length) throw new HttpError(400, 'bad_items', 'Mã lượt gọi bị trùng.');
  const params = { label: s(b.params && b.params.label, 120), feature: s(b.params && b.params.feature, 40), meta: b.params && b.params.meta && typeof b.params.meta === 'object' ? b.params.meta : null };
  if (kind === 'probe') {
    const j = b.params && b.params.judge || {};
    const truth = String(j.truth || '');
    if (truth.length < 3 || truth.length > 60_000) throw new HttpError(400, 'bad_params', 'Thiếu hồ sơ chuẩn để chấm.');
    const models = {};
    for (const e of ENGINES) if (j.models && j.models[e]) models[e] = selectedModel('judge', j.models[e], MODELS());
    params.judge = { truth, brand: s(j.brand, 200), models, base: selectedModel('judge', j.base, MODELS()) };
  }
  // Ước lượng trước: không giao việc vượt hạn mức hôm nay
  const used = await getUsage(user.email).catch(() => 0), lim = dailyLimit();
  if (used + clean.length > lim) throw new HttpError(429, 'daily_limit', `Việc này cần khoảng ${clean.length} lượt gọi, hôm nay còn ${Math.max(0, lim - used)}/${lim}.`);
  const ins = await rest('POST', 'ai_jobs', { body: { audit_id: auditId, kind, created_by: user.email, params, total: clean.length, stage: kind === 'probe' ? 'ask' : 'gen', summary: {} }, prefer: 'return=representation' });
  if (ins.status === 409 || (ins.json && ins.json.code === '23505')) {
    const cur = rows(await rest('GET', `ai_jobs?audit_id=eq.${encodeURIComponent(auditId)}&kind=eq.${kind}&status=in.(queued,running)&select=id,created_by`))[0];
    throw new HttpError(409, 'job_running', `Audit này đang có việc ${kind === 'probe' ? 'Hỏi AI' : 'AI'} chạy nền${cur ? ' (' + cur.created_by + ')' : ''}. Đợi xong hoặc dừng việc đó trước.`, { jobId: cur && cur.id });
  }
  const job = rows(ins)[0];
  const stage = kind === 'probe' ? 'ask' : 'gen';
  for (let i = 0; i < clean.length; i += 500) {
    const r = await rest('POST', 'ai_job_items', { body: clean.slice(i, i + 500).map((x) => ({ job_id: job.id, stage, key: x.key, payload: x.payload })), prefer: 'return=minimal' });
    if (r.status >= 300) { await rest('DELETE', `ai_jobs?id=eq.${job.id}`); throw new HttpError(502, 'db_error', 'Không lưu được danh sách lượt gọi.'); }
  }
  kick();
  ok(res, { job: publicJob(job) });
});

const publicJob = (j) => ({ id: j.id, auditId: j.audit_id, kind: j.kind, status: j.status, stage: j.stage, createdBy: j.created_by, createdAt: j.created_at, startedAt: j.started_at, finishedAt: j.finished_at,
  heartbeatAt: j.heartbeat_at, total: j.total, done: j.done, summary: j.summary || {}, error: j.error, appliedAt: j.applied_at, label: j.params && j.params.label || '', feature: j.params && j.params.feature || '' });

/* ---------- xem, dừng, nhận kết quả ---------- */
export const get = route(async (req, res) => {
  allowMethods(req, ['GET']);
  await requireUser(req, res);
  const id = String((req.query && req.query.id) || '');
  if (!UUID.test(id)) throw new HttpError(400, 'bad_id', 'Mã việc không hợp lệ.');
  const j = rows(await rest('GET', `ai_jobs?id=eq.${id}&select=*`))[0];
  if (!j) throw new HttpError(404, 'not_found', 'Không tìm thấy việc.');
  // việc đang chạy mà quá lâu không có nhịp tim: đánh thức bộ chạy
  if (['queued', 'running'].includes(j.status) && (!j.heartbeat_at || Date.now() - Date.parse(j.heartbeat_at) > 90_000)) kick();
  ok(res, { job: publicJob(j) });
});

export const list = route(async (req, res) => {
  allowMethods(req, ['GET']);
  await requireUser(req, res);
  const auditId = s(req.query && req.query.auditId, 64);
  if (!/^[A-Za-z0-9_-]{3,64}$/.test(auditId)) throw new HttpError(400, 'bad_audit', 'Mã audit không hợp lệ.');
  const js = rows(await rest('GET', `ai_jobs?audit_id=eq.${encodeURIComponent(auditId)}&select=*&order=created_at.desc&limit=10`));
  if (js.some((j) => ['queued', 'running'].includes(j.status) && (!j.heartbeat_at || Date.now() - Date.parse(j.heartbeat_at) > 90_000))) kick();
  ok(res, { jobs: js.map(publicJob) });
});

export const cancel = route(async (req, res) => {
  allowMethods(req, ['POST']);
  const user = await requireUser(req, res);
  const b = await readJson(req, 2_000);
  if (!UUID.test(String(b.id || ''))) throw new HttpError(400, 'bad_id', 'Mã việc không hợp lệ.');
  const r = rows(await rest('PATCH', `ai_jobs?id=eq.${b.id}&status=in.(queued,running)`, { body: { status: 'canceled', finished_at: nowIso(), lock_until: null, error: 'Đã dừng bởi ' + user.email }, prefer: 'return=representation' }));
  ok(res, { job: r[0] ? publicJob(r[0]) : null });
});

/** Nhận kết quả để gộp vào audit – chỉ một người nhận được (chống gộp hai lần). */
export const results = route(async (req, res) => {
  allowMethods(req, ['POST']);
  const user = await requireUser(req, res);
  const b = await readJson(req, 2_000);
  if (!UUID.test(String(b.id || ''))) throw new HttpError(400, 'bad_id', 'Mã việc không hợp lệ.');
  const r = rows(await rest('PATCH', `ai_jobs?id=eq.${b.id}&applied_at=is.null&status=in.(done,failed,canceled)`, { body: { applied_at: nowIso(), applied_by: user.email }, prefer: 'return=representation' }));
  if (!r[0]) throw new HttpError(409, 'already_applied', 'Kết quả việc này đã được gộp vào audit (hoặc việc chưa xong).');
  const items = [];
  for (let from = 0; ; from += 1000) {
    const page = rows(await rest('GET', `ai_job_items?job_id=eq.${b.id}&select=stage,key,payload,status,result,error&order=key&limit=1000&offset=${from}`));
    items.push(...page.map((x) => ({ ...x, payload: x.stage === 'judge' ? { g: x.payload.g, e: x.payload.e, run: x.payload.run, keys: x.payload.keys, model: x.payload.model } : x.payload })));
    if (page.length < 1000) break;
  }
  ok(res, { job: publicJob(r[0]), items });
});

/** Trả lại trạng thái "chưa gộp" nếu trình duyệt gộp thất bại (ví dụ lưu audit bị xung đột). */
export const unapply = route(async (req, res) => {
  allowMethods(req, ['POST']);
  await requireUser(req, res);
  const b = await readJson(req, 2_000);
  if (!UUID.test(String(b.id || ''))) throw new HttpError(400, 'bad_id', 'Mã việc không hợp lệ.');
  await rest('PATCH', `ai_jobs?id=eq.${b.id}`, { body: { applied_at: null, applied_by: null } });
  ok(res, { ok: true });
});

/* ---------- đánh thức bộ chạy ---------- */
function secretOk(req) {
  const want = process.env.JOBS_SECRET || '', got = String(req.headers['x-jobs-secret'] || '');
  return want.length >= 16 && got.length === want.length && crypto.timingSafeEqual(Buffer.from(got), Buffer.from(want));
}
export const tick = route(async (req, res) => {
  allowMethods(req, ['GET', 'POST']);
  if (!secretOk(req)) await requireUser(req, res);   // pg_cron/chuỗi tự gọi dùng khóa bí mật; người đang mở app cũng đánh thức được
  kick();
  ok(res, { ok: true });
});
let running = null;
/** Chạy bộ xử lý sau khi đã trả lời (waitUntil giữ hàm sống tới khi xong). Mỗi phiên bản chỉ chạy một vòng một lúc. */
export function kick() {
  if (running) return running;
  // Gọi đợt sau CHỈ khi vòng này đã nhả hẳn – nếu gọi sớm, yêu cầu có thể rơi vào chính phiên bản này, thấy "đang chạy" và bị bỏ qua (treo việc).
  running = runWorker().catch((e) => { console.error('[jobs] worker', e && e.stack || e); return true; })
    .then((more) => { running = null; return more ? chainNext() : undefined; });
  try { waitUntil(running); } catch { /* ngoài Vercel: tiến trình Node vẫn chạy tiếp */ }
  return running;
}
async function chainNext() {
  const secret = process.env.JOBS_SECRET;
  if (!secret) return console.warn('[jobs] thiếu JOBS_SECRET: không tự gọi đợt sau được, chờ pg_cron hoặc người dùng mở app');
  try {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 8000);
    await fetch(`${appUrl()}/api/probe?op=tick`, { method: 'POST', headers: { 'x-jobs-secret': secret }, signal: ctl.signal }).catch(() => {});
    clearTimeout(t);
  } catch { /* pg_cron sẽ đánh thức */ }
}

/* ---------- bộ chạy ---------- */
export async function runWorker() {
  const deadline = Date.now() + budgetMs();
  let more = false;
  const margin = Math.min(15_000, budgetMs() / 5);
  while (Date.now() < deadline - margin) {
    const c = await rpc('job_claim', { p_lock_seconds: lockSecs() });
    const job = c.status === 200 && Array.isArray(c.json) ? c.json[0] : null;
    if (!job) break;
    const out = await processJob(job, deadline);
    if (out === 'yield') { more = true; break; }
  }
  if (!more) {
    const act = await rest('GET', 'ai_jobs?status=in.(queued,running)&select=id,lock_until&limit=5');
    more = act.status === 200 && Array.isArray(act.json) && act.json.some((j) => !j.lock_until || Date.parse(j.lock_until) < Date.now() + 5_000);
  }
  return more;
}

async function jobStatus(id) { const r = await rest('GET', `ai_jobs?id=eq.${id}&select=status`); return r.status === 200 && r.json[0] ? r.json[0].status : 'gone'; }
async function release(job, patch = {}) { await rest('PATCH', `ai_jobs?id=eq.${job.id}`, { body: { lock_until: null, heartbeat_at: nowIso(), ...patch } }); }

async function processJob(job, deadline) {
  const sum = { ...(job.summary || {}) }; sum.halted = sum.halted || []; sum.fails = sum.fails || {}; sum.errors = sum.errors || {};
  let done = job.done || 0;
  const halted = new Set(sum.halted);
  for (;;) {
    const st = await jobStatus(job.id);
    if (st !== 'running') return 'stop';                       // bị dừng hoặc đã xong ở nơi khác
    const stage = job.stage;
    // lượt "đang chạy" quá 150 giây (máy chủ trước tắt giữa chừng) → xếp lại hàng
    await rest('PATCH', `ai_job_items?job_id=eq.${job.id}&stage=eq.${stage}&status=eq.running&updated_at=lt.${encodeURIComponent(new Date(Date.now() - 150_000).toISOString())}`, { body: { status: 'queued' } });
    // thời gian còn lại tối thiểu để bắt đầu một lượt (lượt hỏi có web tối đa ~100 giây)
    const need = stage === 'ask' ? envInt('JOB_MIN_LEFT_ASK_MS', 110_000) : envInt('JOB_MIN_LEFT_GEN_MS', 75_000);
    if (deadline - Date.now() < need) { await release(job, { summary: { ...sum, halted: [...halted] }, done }); return 'yield'; }
    const q = rows(await rest('GET', `ai_job_items?job_id=eq.${job.id}&stage=eq.${stage}&status=eq.queued&select=id,key,payload,attempts&order=key&limit=${CONC()}`));
    if (!q.length) {
      const left = rows(await rest('GET', `ai_job_items?job_id=eq.${job.id}&stage=eq.${stage}&status=eq.running&select=id&limit=1`));
      if (left.length) { await release(job, { summary: { ...sum, halted: [...halted] }, done }); return 'yield'; }  // còn lượt của máy chủ khác
      if (job.kind === 'probe' && stage === 'ask') {
        const n = await buildJudge(job);
        job.stage = 'judge'; sum.judgeTotal = n; sum.judgeDone = 0;
        await rest('PATCH', `ai_jobs?id=eq.${job.id}`, { body: { stage: 'judge', summary: { ...sum, halted: [...halted] }, done, heartbeat_at: nowIso(), lock_until: new Date(Date.now() + lockSecs() * 1000).toISOString() } });
        continue;
      }
      await rest('PATCH', `ai_jobs?id=eq.${job.id}&status=eq.running`, { body: { status: 'done', finished_at: nowIso(), lock_until: null, heartbeat_at: nowIso(), done, summary: { ...sum, halted: [...halted] } } });
      return 'done';
    }
    // AI đã bị dừng gửi: bỏ qua các lượt còn lại của AI đó
    const skip = q.filter((it) => stage === 'ask' && halted.has(it.payload.engine));
    if (skip.length) { await rest('PATCH', `ai_job_items?id=in.(${skip.map((x) => x.id).join(',')})`, { body: { status: 'skipped', error: 'AI này đã bị dừng gửi do lỗi trước đó', updated_at: nowIso() } }); done += skip.length; }
    const batch = q.filter((it) => !skip.includes(it));
    if (batch.length) await rest('PATCH', `ai_job_items?id=in.(${batch.map((x) => x.id).join(',')})`, { body: { status: 'running', updated_at: nowIso() } });
    let stopAll = null, canceled = false;
    await pool(batch, CONC(), async (it) => {
      // Kiểm tra trước TỪNG lượt: bấm Dừng là không gửi thêm câu nào tới AI (không tốn thêm tiền)
      if (!stopAll && !canceled && (await jobStatus(job.id)) !== 'running') canceled = true;
      if (stopAll || canceled) { await rest('PATCH', `ai_job_items?id=eq.${it.id}`, { body: { status: 'queued' } }); return; }
      try {
        const result = stage === 'ask' ? await runAsk(job, it.payload) : await runGen(job, it.payload, stage);
        await rest('PATCH', `ai_job_items?id=eq.${it.id}`, { body: { status: 'done', result, error: null, updated_at: nowIso() } });
        if (stage === 'judge') sum.judgeDone = (sum.judgeDone || 0) + 1; else done++;
        if (stage === 'ask') sum.fails[it.payload.engine] = 0;
      } catch (err) {
        const code = err && err.code || 'error', msg = s(err && err.message || code, 300);
        if (code === 'daily_limit') { stopAll = msg; await rest('PATCH', `ai_job_items?id=eq.${it.id}`, { body: { status: 'queued' } }); return; }
        if (RETRY.includes(code) && (it.attempts || 0) < 1) { await rest('PATCH', `ai_job_items?id=eq.${it.id}`, { body: { status: 'queued', attempts: (it.attempts || 0) + 1, error: msg, updated_at: nowIso() } }); return; }
        await rest('PATCH', `ai_job_items?id=eq.${it.id}`, { body: { status: 'failed', error: msg, attempts: (it.attempts || 0) + 1, updated_at: nowIso() } });
        const eng = stage === 'ask' ? it.payload.engine : 'judge';
        const ek = `${eng}|${code}`; sum.errors[ek] = { n: ((sum.errors[ek] || {}).n || 0) + 1, msg };
        if (stage === 'judge') { sum.judgeDone = (sum.judgeDone || 0) + 1; sum.judgeFail = (sum.judgeFail || 0) + 1; } else done++;
        if (stage === 'ask') { sum.fails[eng] = (sum.fails[eng] || 0) + 1; if (FATAL.includes(code) || sum.fails[eng] >= 3) halted.add(eng); }
      }
    });
    if (canceled) return 'stop';
    if (stopAll) {
      await rest('PATCH', `ai_jobs?id=eq.${job.id}`, { body: { status: 'failed', error: stopAll, finished_at: nowIso(), lock_until: null, done, summary: { ...sum, halted: [...halted] } } });
      return 'stop';
    }
    await rest('PATCH', `ai_jobs?id=eq.${job.id}&status=eq.running`, { body: { done, summary: { ...sum, halted: [...halted] }, heartbeat_at: nowIso(), lock_until: new Date(Date.now() + lockSecs() * 1000).toISOString() } });
  }
}

async function runAsk(job, p) {
  await bump(job.created_by, 1);
  const maxTokens = envInt(`PROBE_MAX_TOKENS_${p.engine.toUpperCase()}`, PROBE_MAX_TOKENS[p.engine]);
  const r = await ask(p.engine, { prompt: p.prompt, system: PROBE_SYSTEM, web: p.web, maxTokens, model: p.model, deadline: Date.now() + 100_000 });
  return { text: String(r.text || '').slice(0, 8000), sources: (r.sources || []).slice(0, 20), queries: (r.queries || []).slice(0, 10), model: r.model || p.model, searchLocation: r.searchLocation || null, truncated: !!r.truncated };
}
async function runGen(job, p, stage) {
  const prompt = stage === 'judge' ? globalThis.CheckAIProbe.judgePrompt(job.params.judge, p.g, p.items) : p.prompt;
  const r = await judgeOrWrite({ email: job.created_by, model: p.model, prompt, json: stage === 'judge' ? true : !!p.json, maxTokens: p.maxTokens || 3000 });
  return { json: r.json === undefined ? null : r.json, text: r.json === undefined ? String(r.text || '').slice(0, 60_000) : undefined, model: r.model || p.model, fallback: r.fallback || null };
}

/** Sau khi hỏi xong: gom câu trả lời theo nhóm × AI × lần lặp, mỗi lô 8 câu → các lượt chấm. */
async function buildJudge(job) {
  const done = [];
  for (let from = 0; ; from += 1000) {
    const page = rows(await rest('GET', `ai_job_items?job_id=eq.${job.id}&stage=eq.ask&status=eq.done&select=key,payload,result&order=key&limit=1000&offset=${from}`));
    done.push(...page); if (page.length < 1000) break;
  }
  const by = {};
  for (const it of done) { const p = it.payload, k = `${p.g}|${p.engine}|${p.run}`; (by[k] = by[k] || []).push(it); }
  const out = [];
  for (const k in by) {
    const arr = by[k], [g, e, run] = k.split('|');
    for (let i = 0; i < arr.length; i += 8) {
      const part = arr.slice(i, i + 8);
      out.push({ job_id: job.id, stage: 'judge', key: `${k}|${String(i / 8).padStart(3, '0')}`, payload: {
        g, e, run: Number(run), model: (job.params.judge.models || {})[e] || job.params.judge.base || MODELS().judge, maxTokens: 3000,
        keys: part.map((x) => x.key),
        items: part.map((x) => ({ id: x.payload.pid, q: x.payload.prompt, a: x.result.truncated ? x.result.text + '\n[Lưu ý: câu trả lời bị cắt do giới hạn độ dài.]' : x.result.text })) } });
    }
  }
  for (let i = 0; i < out.length; i += 200) {
    const r = await rest('POST', 'ai_job_items?on_conflict=job_id,stage,key', { body: out.slice(i, i + 200), prefer: 'resolution=ignore-duplicates,return=minimal' });
    if (r.status >= 300) throw new HttpError(502, 'db_error', 'Không tạo được lượt chấm.');
  }
  return out.length;
}

async function pool(list, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, list.length) }, async () => { while (i < list.length) { const x = list[i++]; await fn(x); } }));
}
