import { route, ok, allowMethods, readJson, HttpError } from './_lib/util.js';
import { requireUser } from './_lib/auth.js';
import { rest } from './_lib/supabase.js';
import { newToken, hashToken, AUDIT_ID } from './_lib/intake.js';

const COLS = 'id,created_by,created_at,expires_at,revoked,ai_calls,submissions,last_used_at';

/** Quản lý link cho thương hiệu tự nhập (chỉ người trong đội NetSpace). Token chỉ trả về một lần khi tạo. */
export default route(async (req, res) => {
  allowMethods(req, ['GET', 'POST', 'DELETE']);
  const user = await requireUser(req, res);
  if (req.method === 'GET') {
    const id = String(req.query && req.query.auditId || '');
    if (!AUDIT_ID.test(id)) throw new HttpError(400, 'bad_id', 'Mã audit không hợp lệ.');
    const r = await rest('GET', `intake_links?audit_id=eq.${encodeURIComponent(id)}&select=${COLS}&order=created_at.desc&limit=20`);
    if (r.status !== 200 || !Array.isArray(r.json)) throw new HttpError(502, 'db_error', 'Không đọc được danh sách link. Kiểm tra đã chạy SQL 002_intake.sql chưa.');
    return ok(res, { links: r.json });
  }
  if (req.method === 'DELETE') {
    const id = String(req.query && req.query.id || '');
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new HttpError(400, 'bad_id', 'Mã link không hợp lệ.');
    const r = await rest('PATCH', `intake_links?id=eq.${id}`, { body: { revoked: true }, prefer: 'return=representation' });
    if (r.status >= 300) throw new HttpError(502, 'db_error', 'Không thu hồi được link.');
    return ok(res, { ok: true });
  }
  const b = await readJson(req, 5000);
  const auditId = String(b.auditId || ''), days = Math.min(Math.max(parseInt(b.days, 10) || 14, 1), 30);
  if (!AUDIT_ID.test(auditId)) throw new HttpError(400, 'bad_id', 'Mã audit không hợp lệ.');
  const a = await rest('GET', `audits?id=eq.${encodeURIComponent(auditId)}&select=id`);
  if (a.status !== 200 || !Array.isArray(a.json) || !a.json.length) throw new HttpError(404, 'not_found', 'Audit chưa được lưu lên máy chủ.');
  const token = newToken(), expires = new Date(Date.now() + days * 86400000).toISOString();
  const r = await rest('POST', 'intake_links', { body: { token_hash: hashToken(token), audit_id: auditId, created_by: user.email, expires_at: expires }, prefer: 'return=representation' });
  if (r.status >= 300 || !Array.isArray(r.json) || !r.json[0]) throw new HttpError(502, 'db_error', 'Không tạo được link. Kiểm tra đã chạy SQL 002_intake.sql chưa.');
  ok(res, { id: r.json[0].id, token, expiresAt: expires });
});
