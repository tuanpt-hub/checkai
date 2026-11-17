import { route, ok, allowMethods, readJson, HttpError } from './_lib/util.js';
import { rest } from './_lib/supabase.js';
import { linkFromRequest, limitIp, cleanSubmission, FIELDS, AI_LIMIT, SUBMISSION_LIMIT } from './_lib/intake.js';

/** Trang công khai cho thương hiệu: đọc hồ sơ hiện có và gửi thông tin vào hàng chờ duyệt. Không trả điểm hay dữ liệu audit khác. */
export default route(async (req, res) => {
  allowMethods(req, ['GET', 'POST']);
  limitIp(req, 'intake', 60, 10 * 60_000);
  const link = await linkFromRequest(req);
  if (req.method === 'GET') {
    const r = await rest('GET', `audits?id=eq.${encodeURIComponent(link.audit_id)}&select=data`);
    const data = r.status === 200 && Array.isArray(r.json) && r.json[0] ? r.json[0].data : null;
    if (!data) throw new HttpError(410, 'link_expired', 'Hồ sơ không còn tồn tại.');
    const p = data.profile || {}, fields = {};
    for (const k of Object.keys(FIELDS)) fields[k] = typeof p[k] === 'string' ? p[k] : '';
    const competitors = (data.competitors || []).filter(c => c && c.status === 'approved').map(c => ({ name: String(c.name || ''), aliases: String(c.aliases || '') }));
    return ok(res, { brand: fields.brand, expiresAt: link.expires_at, fields, competitors,
      aiLeft: Math.max(0, AI_LIMIT() - (link.ai_calls || 0)), submissionsLeft: Math.max(0, SUBMISSION_LIMIT() - (link.submissions || 0)) });
  }
  limitIp(req, 'intake-post', 10, 10 * 60_000);
  if ((link.submissions || 0) >= SUBMISSION_LIMIT()) throw new HttpError(429, 'submission_limit', 'Link này đã đạt số lần gửi tối đa. Liên hệ NetSpace.');
  const sub = cleanSubmission(await readJson(req, 80_000));
  if (!Object.values(sub.fields).some(v => v.trim()) && !sub.competitors.length) throw new HttpError(400, 'empty', 'Chưa có thông tin nào để gửi.');
  const ins = await rest('POST', 'intake_submissions', { body: { audit_id: link.audit_id, link_id: link.id, data: sub }, prefer: 'return=minimal' });
  if (ins.status >= 300) throw new HttpError(502, 'db_error', 'Chưa gửi được. Thử lại sau ít phút.');
  await rest('PATCH', `intake_links?id=eq.${link.id}`, { body: { submissions: (link.submissions || 0) + 1, last_used_at: new Date().toISOString() } });
  ok(res, { ok: true, submissionsLeft: Math.max(0, SUBMISSION_LIMIT() - (link.submissions || 0) - 1) });
});
