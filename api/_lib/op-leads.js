import { route, ok, allowMethods, readJson, HttpError } from './util.js';
import { requireUser } from './auth.js';
import { rest } from './supabase.js';
import { siteUrl } from './notify.js';

export const STATUSES = ['new', 'contacted', 'health_check', 'audit', 'transformation', 'intelligence', 'lost'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** GET /api/leads – khách tiềm năng mới nhất, kèm tóm tắt Health Check (nếu có). */
export const list = route(async (req, res) => {
  allowMethods(req, ['GET']);
  await requireUser(req, res);
  const st = String((req.query && req.query.status) || '');
  const filter = STATUSES.includes(st) ? `&status=eq.${st}` : '';
  const r = await rest('GET', `leads?select=*&order=created_at.desc&limit=200${filter}`);
  if (r.status !== 200 || !Array.isArray(r.json)) throw new HttpError(502, 'db_error', 'Không đọc được danh sách khách tiềm năng.');
  const leads = r.json.map(({ ip_hash, ...x }) => x);
  const ids = leads.map((l) => l.id).filter((id) => UUID.test(id));
  let hcs = [];
  if (ids.length) {
    const h = await rest('GET', `health_checks?lead_id=in.(${ids.join(',')})&select=id,lead_id,status,created_at,finished_at,domain,report,report_token,report_expires_at,report_revoked,view_count,first_viewed_at,last_viewed_at&order=created_at.desc`);
    if (h.status === 200 && Array.isArray(h.json)) hcs = h.json;
  }
  for (const l of leads) {
    const hc = hcs.find((x) => x.lead_id === l.id);
    l.hc = hc ? { status: hc.status, created_at: hc.created_at, finished_at: hc.finished_at, domain: hc.domain,
      reportUrl: hc.report_token ? `${siteUrl()}/r/${hc.report_token}` : null,
      summary: hc.report ? hc.report.summary : null, recognition: hc.report ? hc.report.recognition : null,
      accuracy: hc.report ? hc.report.accuracy : null, actions: hc.report ? hc.report.actions : [],
      expiresAt: hc.report_expires_at, revoked: !!hc.report_revoked, views: hc.view_count || 0, firstViewedAt: hc.first_viewed_at, lastViewedAt: hc.last_viewed_at } : null;
  }
  ok(res, { leads, statuses: STATUSES });
});

/** POST /api/leads?op=update – đổi trạng thái, ghi chú nội bộ, gắn audit đã tạo từ lead. */
export const update = route(async (req, res) => {
  allowMethods(req, ['POST']);
  const user = await requireUser(req, res);
  const b = await readJson(req, 10_000);
  if (!UUID.test(String(b.id || ''))) throw new HttpError(400, 'bad_id', 'Mã khách tiềm năng không hợp lệ.');
  const patch = { updated_at: new Date().toISOString(), updated_by: user.email };
  if (b.status !== undefined) { if (!STATUSES.includes(b.status)) throw new HttpError(400, 'bad_status', 'Trạng thái không hợp lệ.'); patch.status = b.status; }
  if (b.staff_note !== undefined) patch.staff_note = String(b.staff_note || '').slice(0, 4000);
  if (b.audit_id !== undefined) { const a = String(b.audit_id || ''); if (a && !/^[A-Za-z0-9_-]{3,64}$/.test(a)) throw new HttpError(400, 'bad_audit', 'Mã audit không hợp lệ.'); patch.audit_id = a || null; }
  const r = await rest('PATCH', `leads?id=eq.${b.id}`, { body: patch, prefer: 'return=representation' });
  if (r.status >= 300 || !Array.isArray(r.json) || !r.json[0]) throw new HttpError(404, 'not_found', 'Không tìm thấy khách tiềm năng.');
  const { ip_hash, ...lead } = r.json[0];
  ok(res, { lead });
});

/** POST /api/leads?op=report – gia hạn thêm 30 ngày, thu hồi, hoặc mở lại đường dẫn báo cáo của lead. */
export const reportLink = route(async (req, res) => {
  allowMethods(req, ['POST']);
  await requireUser(req, res);
  const b = await readJson(req, 2_000);
  if (!UUID.test(String(b.id || ''))) throw new HttpError(400, 'bad_id', 'Mã khách tiềm năng không hợp lệ.');
  if (!['extend', 'revoke', 'restore'].includes(b.action)) throw new HttpError(400, 'bad_action', 'Thao tác không hợp lệ.');
  const r = await rest('GET', `health_checks?lead_id=eq.${b.id}&status=eq.done&select=id,report_expires_at,finished_at&order=created_at.desc&limit=1`);
  const hc = r.status === 200 && Array.isArray(r.json) ? r.json[0] : null;
  if (!hc) throw new HttpError(404, 'not_found', 'Lead này chưa có báo cáo Health Check.');
  const days = Number(process.env.HC_REPORT_DAYS) || 30, cur = Date.parse(hc.report_expires_at || hc.finished_at || 0) || Date.now();
  const patch = b.action === 'revoke' ? { report_revoked: true }
    : b.action === 'restore' ? { report_revoked: false }
    : { report_revoked: false, report_expires_at: new Date(Math.max(cur, Date.now()) + days * 86400_000).toISOString() };
  const u = await rest('PATCH', `health_checks?id=eq.${hc.id}`, { body: patch, prefer: 'return=representation' });
  if (u.status >= 300 || !Array.isArray(u.json) || !u.json[0]) throw new HttpError(502, 'db_error', 'Chưa lưu được.');
  ok(res, { expiresAt: u.json[0].report_expires_at, revoked: !!u.json[0].report_revoked });
});
