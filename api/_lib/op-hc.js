import { route, ok, allowMethods, readJson, HttpError, envInt } from './util.js';
import { rest, rpc } from './supabase.js';
import { limitIp } from './intake.js';
import { verifyTurnstile } from './turnstile.js';
import fs from 'node:fs';
import { email, mailBody, notifySales, telegram, siteUrl, appUrl } from './notify.js';
import { ogPng } from './og.js';
import { ask, PROBE_SYSTEM, MODELS } from './providers.js';
import { judgeOrWrite } from './judge.js';
import { normalizeTarget } from './safe-fetch.js';
import { runScan } from './op-scan.js';
import { QUESTIONS, QIDS, ENGINE_LABEL, hcEngines, hcModel, hcJudgeModel, dailyCap, cooldownDays, CONSENT_TEXT, CONSENT_FORM,
  hashT, newT, ipHash, vnDay, cleanLeadForm, cleanHcForm, domainOf, attribution, hcFromSession, takeCall, judgePrompt, buildReport, publicReport } from './hc.js';

const REPORT_DAYS = () => envInt('HC_REPORT_DAYS', 30);
const PROBE_TOKENS = { claude: 1500, openai: 4000, gemini: 4096, grok: 3000, deepseek: 4000 };
const devMode = () => process.env.VERCEL !== '1';
const rows = (r) => (r.status === 200 && Array.isArray(r.json) ? r.json : null);
const must = (r, msg) => { const x = rows(r); if (!x) throw new HttpError(502, 'db_error', msg || 'Lỗi cơ sở dữ liệu. Thử lại sau ít phút.'); return x; };
const insert1 = async (table, body) => {
  const r = await rest('POST', table, { body, prefer: 'return=representation' });
  if (r.status >= 300 || !Array.isArray(r.json) || !r.json[0]) throw new HttpError(502, 'db_error', 'Chưa lưu được. Thử lại sau ít phút.');
  return r.json[0];
};
/** Yêu cầu ghi công khai phải đến từ chính trang này (chặn trang khác gửi thay khách). */
const sameOrigin = (req) => {
  const o = req.headers.origin; if (!o) return;
  let h = ''; try { h = new URL(o).host; } catch { /* bỏ qua */ }
  if (h !== (req.headers['x-forwarded-host'] || req.headers.host)) throw new HttpError(403, 'forbidden', 'Yêu cầu bị từ chối.');
};
const usedToday = async () => must(await rest('GET', `health_checks?verified_day=eq.${vnDay()}&select=id`)).length;

/** GET /api/hc?op=config – khóa site Turnstile (công khai), AI sẽ hỏi, còn lượt hôm nay không. */
export const config = route(async (req, res) => {
  allowMethods(req, ['GET']);
  const engines = hcEngines();
  let open = engines.length > 0;
  try { if (open) open = (await usedToday()) < dailyCap(); } catch { /* chỉ để hiển thị */ }
  ok(res, { turnstileSiteKey: process.env.TURNSTILE_SITE_KEY || null, engines: engines.map((e) => ({ id: e, label: ENGINE_LABEL[e] })), questions: QIDS.length, open });
});

/** POST /api/hc?op=lead – biểu mẫu đặt lịch tư vấn trên landing. */
export const lead = route(async (req, res) => {
  allowMethods(req, ['POST']);
  sameOrigin(req);
  await limitIp(req, 'lead', 5, 10 * 60_000, { shared: true });
  const b = await readJson(req, 20_000);
  await verifyTurnstile(req, b.turnstile);
  const f = cleanLeadForm(b), at = attribution(b);
  const row = await insert1('leads', { source: 'form', ...f, brand: f.company || null, consent_at: new Date().toISOString(), consent_text: CONSENT_FORM, ...at, ip_hash: ipHash(req) });
  await notifySales(`Lead mới từ brand.ai.vn: ${f.company || f.name}`, [
    `Người liên hệ: ${f.name}${f.title ? ' – ' + f.title : ''}`, f.company && `Công ty: ${f.company}`, `Email: ${f.email}`, f.phone && `Điện thoại: ${f.phone}`,
    f.website && `Website: ${f.website}`, f.package && `Gói quan tâm: ${f.package}`, f.note && `Ghi chú: ${f.note}`,
    (at.ai_referrer || at.utm.utm_source) && `Nguồn: ${at.ai_referrer || at.utm.utm_source}`,
  ], `${appUrl()}/?lead=${row.id}`);
  ok(res, { ok: true });
});

/** POST /api/hc?op=start – đăng ký Health Check; gửi email xác minh. */
export const start = route(async (req, res) => {
  allowMethods(req, ['POST']);
  sameOrigin(req);
  await limitIp(req, 'hc-start', 5, 10 * 60_000, { shared: true });
  const b = await readJson(req, 20_000);
  await verifyTurnstile(req, b.turnstile);
  const f = cleanHcForm(b), domain = domainOf(f.website), at = attribution(b);
  const since = new Date(Date.now() - cooldownDays() * 86400_000).toISOString();
  if (must(await rest('GET', `health_checks?domain=eq.${encodeURIComponent(domain)}&status=eq.done&created_at=gte.${since}&select=id&limit=1`)).length)
    throw new HttpError(409, 'recent_check', `Tên miền ${domain} đã được kiểm tra trong ${cooldownDays()} ngày qua; kết quả đã gửi về email đăng ký lúc đó. Cần phân tích sâu hơn, hãy đặt lịch tư vấn.`);
  const day = new Date(Date.now() - 86400_000).toISOString();
  if (must(await rest('GET', `health_checks?email=eq.${encodeURIComponent(f.email)}&created_at=gte.${day}&select=id`)).length >= 3)
    throw new HttpError(429, 'too_many_requests', 'Email này đã đăng ký nhiều lần trong 24 giờ. Kiểm tra hộp thư (kể cả thư rác) hoặc thử lại sau.');
  const leadRow = await insert1('leads', { source: 'health_check', name: f.name || null, company: f.company || null, brand: f.brand, website: f.website, email: f.email,
    consent_at: new Date().toISOString(), consent_text: CONSENT_TEXT, ...at, ip_hash: ipHash(req) });
  const token = newT();
  await insert1('health_checks', { lead_id: leadRow.id, brand: f.brand, website: f.website, domain, email: f.email, status: 'pending',
    verify_hash: hashT(token), verify_expires_at: new Date(Date.now() + 24 * 3600_000).toISOString(), ip_hash: ipHash(req) });
  const link = `${siteUrl()}/kiem-tra#v=${token}`;
  const body = mailBody(`Xác nhận để chạy AI Health Check cho ${f.brand}`, [
    `Chào ${f.name || 'anh/chị'},`, `Bấm nút dưới đây để bắt đầu kiểm tra ${f.brand} (${domain}) trên ${hcEngines().map((e) => ENGINE_LABEL[e]).join(', ')}. Quá trình mất khoảng 2–3 phút; hãy giữ trang mở đến khi xong.`,
    'Đường dẫn có hiệu lực trong 24 giờ. Nếu anh/chị không đăng ký, hãy bỏ qua email này.' ], { href: link, label: 'Bắt đầu kiểm tra' });
  const sent = await email({ to: f.email, subject: `Xác nhận AI Health Check cho ${f.brand}`, ...body });
  ok(res, { ok: true, emailSent: sent.sent, ...(devMode() && !sent.sent ? { devVerifyUrl: link } : {}) });
});

/** POST /api/hc?op=verify – mở phiên từ đường dẫn trong email. */
export const verify = route(async (req, res) => {
  allowMethods(req, ['POST']);
  sameOrigin(req);
  await limitIp(req, 'hc-verify', 20, 10 * 60_000, { shared: true });
  const b = await readJson(req, 2_000), token = String(b.token || '');
  if (!/^[A-Za-z0-9_-]{30,100}$/.test(token)) throw new HttpError(400, 'bad_link', 'Đường dẫn không hợp lệ.');
  const hc = must(await rest('GET', `health_checks?verify_hash=eq.${hashT(token)}&select=*`))[0];
  if (!hc) throw new HttpError(404, 'bad_link', 'Đường dẫn không hợp lệ hoặc đã được dùng.');
  if (hc.status === 'done') return ok(res, { done: true, reportUrl: `/r/${hc.report_token}`, brand: hc.brand });
  if (hc.status === 'failed') throw new HttpError(410, 'hc_failed', 'Lượt kiểm tra này không hoàn tất. Hãy đăng ký lại.');
  if (hc.status === 'pending' && Date.parse(hc.verify_expires_at) < Date.now()) throw new HttpError(410, 'link_expired', 'Đường dẫn đã quá 24 giờ. Hãy đăng ký lại.');
  const engines = hc.status === 'running' && hc.engines && hc.engines.length ? hc.engines : hcEngines();
  if (!engines.length) throw new HttpError(503, 'not_configured', 'Hệ thống tạm chưa sẵn sàng. Thử lại sau.');
  const patch = { session_hash: null, session_expires_at: new Date(Date.now() + 2 * 3600_000).toISOString() };
  if (hc.status === 'pending') {
    if ((await usedToday()) >= dailyCap()) throw new HttpError(429, 'daily_cap', 'Hôm nay đã hết lượt kiểm tra miễn phí. Mở lại đường dẫn này vào ngày mai (trong 24 giờ kể từ khi đăng ký), hoặc đặt lịch để chuyên viên NetSpace kiểm tra.');
    Object.assign(patch, { status: 'running', verified_at: new Date().toISOString(), verified_day: vnDay(), engines, calls_limit: engines.length * (QIDS.length + 3) });
  }
  const session = newT(); patch.session_hash = hashT(session);
  const up = await rest('PATCH', `health_checks?id=eq.${hc.id}&status=eq.${hc.status}`, { body: patch, prefer: 'return=representation' });
  if (!rows(up) || !up.json.length) throw new HttpError(409, 'conflict', 'Phiên đang được mở ở nơi khác. Tải lại trang.');
  ok(res, { session, brand: hc.brand, website: hc.website, engines: engines.map((e) => ({ id: e, label: ENGINE_LABEL[e] })), qids: QIDS });
});

/** POST /api/hc?op=scan – quét kỹ thuật website (không tốn lượt AI). */
export const scan = route(async (req, res) => {
  allowMethods(req, ['POST']);
  sameOrigin(req);
  const hc = await hcFromSession(req);
  if (hc.scan) return ok(res, { ok: !hc.scan.error });
  let result;
  try { result = await runScan(normalizeTarget(hc.website)); } catch (e) { result = { error: String((e && e.message) || 'Không quét được website.').slice(0, 300) }; }
  await rest('PATCH', `health_checks?id=eq.${hc.id}`, { body: { scan: result } });
  ok(res, { ok: !result.error });
});

/** POST /api/hc?op=probe – hỏi MỘT câu cố định tới MỘT AI. Câu hỏi do máy chủ tạo, không nhận văn bản tự do từ trình duyệt. */
export const probe = route(async (req, res) => {
  allowMethods(req, ['POST']);
  sameOrigin(req);
  await limitIp(req, 'hc-probe', 80, 10 * 60_000);
  const hc = await hcFromSession(req);
  const b = await readJson(req, 2_000), qid = String(b.qid || ''), engine = String(b.engine || '');
  if (!QIDS.includes(qid) || !(hc.engines || []).includes(engine)) throw new HttpError(400, 'bad_probe', 'Câu hỏi hoặc AI không hợp lệ.');
  const prev = must(await rest('GET', `health_check_answers?hc_id=eq.${hc.id}&qid=eq.${qid}&engine=eq.${engine}&select=id,error`))[0];
  if (prev) return ok(res, { qid, engine, ok: !prev.error, cached: true });
  await takeCall(hc.id);
  let row;
  try {
    const r = await ask(engine, { prompt: QUESTIONS[qid].replace('{brand}', hc.brand), system: PROBE_SYSTEM, web: true,
      maxTokens: envInt(`PROBE_MAX_TOKENS_${engine.toUpperCase()}`, PROBE_TOKENS[engine]), model: hcModel(engine), deadline: Date.now() + 100_000 });
    row = { text: String(r.text || '').slice(0, 6000), sources: (r.sources || []).slice(0, 15), model: r.model || null };
  } catch (e) { row = { error: String((e && e.code) || 'error').slice(0, 60) }; }
  await rest('POST', 'health_check_answers?on_conflict=hc_id,qid,engine', { body: { hc_id: hc.id, qid, engine, ...row }, prefer: 'resolution=ignore-duplicates,return=minimal' });
  ok(res, { qid, engine, ok: !row.error });
});

/** POST /api/hc?op=finish – chấm, lập báo cáo, gửi email cho khách và báo sales. */
export const finish = route(async (req, res) => {
  allowMethods(req, ['POST']);
  sameOrigin(req);
  const hc = await hcFromSession(req);
  const answers = must(await rest('GET', `health_check_answers?hc_id=eq.${hc.id}&select=qid,engine,text,sources,error`));
  if (!answers.some((a) => a.text)) throw new HttpError(409, 'no_answers', 'Chưa có câu trả lời nào từ AI. Thử chạy lại.');
  const judged = {};
  for (const e of hc.engines || []) {
    const list = answers.filter((a) => a.engine === e && a.text).sort((x, y) => x.qid.localeCompare(y.qid));
    if (!list.length) continue;
    try {
      const r = await judgeOrWrite({ email: 'health-check', model: hcJudgeModel() || MODELS().judge, prompt: judgePrompt(hc, e, list), json: true, maxTokens: 1500 },
        { bump: async () => { await takeCall(hc.id); return {}; } });
      judged[e] = Object.fromEntries((Array.isArray(r.json) ? r.json : []).filter((x) => x && QIDS.includes(x.id)).map((x) => [x.id, x]));
    } catch (err) { if (err && err.code === 'hc_limit') break; judged[e] = {}; }
  }
  const report = buildReport(hc, answers, judged), token = newT();
  const up = await rest('PATCH', `health_checks?id=eq.${hc.id}&status=eq.running`, { body: { status: 'done', report, report_token: token, finished_at: new Date().toISOString(), report_expires_at: new Date(Date.now() + REPORT_DAYS() * 86400_000).toISOString(), session_hash: null }, prefer: 'return=representation' });
  if (!rows(up) || !up.json.length) throw new HttpError(409, 'conflict', 'Báo cáo đã được lập ở một phiên khác.');
  const url = `${siteUrl()}/r/${token}`;
  if (hc.lead_id) await rest('PATCH', `leads?id=eq.${hc.lead_id}&status=eq.new`, { body: { status: 'health_check', updated_at: new Date().toISOString() } });
  const mail = mailBody(`Kết quả AI Health Check của ${hc.brand}`, [report.summary, 'Báo cáo gồm: AI nói gì về thương hiệu, mức AI hiểu đúng, website có được trích dẫn không, các kiểm tra kỹ thuật và 3 việc nên làm trước.', `Đường dẫn có hiệu lực ${REPORT_DAYS()} ngày; trên trang báo cáo có nút tải PDF để lưu lại.`, report.caveat], { href: url, label: 'Xem báo cáo' });
  await Promise.all([
    email({ to: hc.email, subject: `Kết quả AI Health Check: ${hc.brand}`, ...mail }),
    notifySales(`AI Health Check xong: ${hc.brand}`, [report.summary, `Website: ${hc.website}`, `Email: ${hc.email}`, `Việc nên làm đầu tiên: ${report.actions[0]}`, `Báo cáo: ${url}`], hc.lead_id ? `${appUrl()}/?lead=${hc.lead_id}` : appUrl()),
  ]);
  ok(res, { reportUrl: `/r/${token}` });
});

/* ---------- báo cáo công khai ---------- */
const TOKEN_RE = /^[A-Za-z0-9_-]{30,100}$/;
const expiresOf = (hc) => hc.report_expires_at || (hc.finished_at ? new Date(Date.parse(hc.finished_at) + REPORT_DAYS() * 86400_000).toISOString() : null);
const isLive = (hc) => hc && hc.status === 'done' && hc.report && !hc.report_revoked && (!expiresOf(hc) || Date.parse(expiresOf(hc)) > Date.now());
async function hcByReport(t) {
  if (!TOKEN_RE.test(t)) return null;
  return must(await rest('GET', `health_checks?report_token=eq.${t}&status=eq.done&select=id,lead_id,brand,status,report,report_revoked,report_expires_at,finished_at`))[0] || null;
}
const device = (ua) => (/ipad|tablet/i.test(ua) ? 'máy tính bảng' : /mobi|iphone|android/i.test(ua) ? 'điện thoại' : 'máy tính');

/** GET /api/hc?op=report&t=… – dữ liệu báo cáo (không lộ email khách); ghi lượt xem, báo sales lần xem đầu. nv=1: người nội bộ xem, không tính. */
export const report = route(async (req, res) => {
  allowMethods(req, ['GET']);
  await limitIp(req, 'hc-report', 60, 10 * 60_000);
  const hc = await hcByReport(String((req.query && req.query.t) || ''));
  if (!hc) throw new HttpError(404, 'not_found', 'Không tìm thấy báo cáo.');
  if (!isLive(hc)) throw new HttpError(410, 'report_expired', hc.report_revoked ? 'Báo cáo này đã được thu hồi.' : 'Đường dẫn báo cáo đã hết hạn.');
  if (String(req.query.nv || '') !== '1') {
    try {
      const v = await rpc('hc_report_view', { p_token: req.query.t, p_device: device(String(req.headers['user-agent'] || '')), p_ip: ipHash(req) });
      const row = v.status < 300 && Array.isArray(v.json) ? v.json[0] : null;
      if (row && row.o_counted && Number(row.o_views) === 1) {
        await telegram(`<b>Khách vừa mở báo cáo lần đầu: ${String(hc.brand).replace(/[&<>]/g, '')}</b>\n${hc.report.summary || ''}\nThiết bị: ${device(String(req.headers['user-agent'] || ''))}${hc.lead_id ? `\n<a href="${appUrl()}/?lead=${hc.lead_id}">Mở khách tiềm năng</a>` : ''}`);
      }
    } catch (e) { console.error('[report_view]', e && e.message); }
  }
  ok(res, { ...publicReport(hc), expiresAt: expiresOf(hc) });
});

/* Trang báo cáo kèm thẻ xem trước (Zalo, Facebook không chạy JavaScript khi đọc đường dẫn). Không tính lượt xem. */
let pageTpl = null;
const pageHtml = () => (pageTpl ??= fs.readFileSync(new URL('../../public/site/report.html', import.meta.url), 'utf8'));
const escH = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** GET /api/hc?op=page&t=… (brand.ai.vn/r/<mã>) */
export const page = route(async (req, res) => {
  allowMethods(req, ['GET']);
  const t = String((req.query && req.query.t) || '');
  let hc = null; try { hc = await hcByReport(t); } catch { /* trang vẫn hiển thị và tự báo lỗi */ }
  const live = isLive(hc), url = `${siteUrl()}/r/${TOKEN_RE.test(t) ? t : ''}`;
  const title = live ? `Kết quả AI Health Check: ${hc.brand}` : 'Kết quả AI Health Check – brand.ai.vn';
  const desc = live ? `AI đang nói gì về ${hc.brand} trên ChatGPT, Gemini, Claude, Grok, DeepSeek. Báo cáo của brand.ai.vn.` : 'AI Health Check miễn phí của brand.ai.vn: xem AI đang nói gì về thương hiệu của bạn.';
  const img = live ? `${siteUrl()}/api/hc?op=og&t=${t}` : `${siteUrl()}/api/hc?op=og`;
  const meta = `<title>${escH(title)}</title>
<meta name="description" content="${escH(desc)}">
<meta property="og:type" content="website"><meta property="og:site_name" content="brand.ai.vn"><meta property="og:url" content="${escH(url)}">
<meta property="og:title" content="${escH(title)}"><meta property="og:description" content="${escH(desc)}">
<meta property="og:image" content="${escH(img)}"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta property="og:image:alt" content="${escH(title)}">
<meta name="twitter:card" content="summary_large_image">`;
  const html = pageHtml().replace(/<title>[\s\S]*?<\/title>/, meta);
  res.statusCode = 200; res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.end(html);
});

/** GET /api/hc?op=og[&t=…] – ảnh xem trước PNG 1200×630 (chỉ tên thương hiệu và tỷ lệ AI nhận ra). */
export const og = route(async (req, res) => {
  allowMethods(req, ['GET']);
  await limitIp(req, 'hc-og', 120, 10 * 60_000);
  const t = String((req.query && req.query.t) || '');
  let hc = null; if (t) { try { hc = await hcByReport(t); } catch { /* ảnh chung */ } }
  const live = isLive(hc), r = live ? hc.report.recognition || {} : {};
  const png = await ogPng(live ? { brand: hc.brand, rate: r.rate } : {});
  res.statusCode = 200; res.setHeader('Content-Type', 'image/png'); res.setHeader('Cache-Control', live ? 'public, max-age=600, s-maxage=3600' : 'public, max-age=86400');
  res.end(png);
});
