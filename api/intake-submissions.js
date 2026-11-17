import { route, ok, allowMethods, readJson, HttpError } from './_lib/util.js';
import { requireUser } from './_lib/auth.js';
import { rest } from './_lib/supabase.js';
import { AUDIT_ID } from './_lib/intake.js';

/** Hàng chờ thông tin thương hiệu gửi lên. Áp dụng vào hồ sơ do giao diện làm (để giữ kiểm tra phiên bản audit); máy chủ chỉ đánh dấu trạng thái. */
export default route(async (req, res) => {
  allowMethods(req, ['GET', 'POST']);
  const user = await requireUser(req, res);
  if (req.method === 'GET') {
    const id = String(req.query && req.query.auditId || '');
    if (!AUDIT_ID.test(id)) throw new HttpError(400, 'bad_id', 'Mã audit không hợp lệ.');
    const r = await rest('GET', `intake_submissions?audit_id=eq.${encodeURIComponent(id)}&status=eq.pending&select=id,link_id,data,status,submitted_at&order=submitted_at.desc&limit=20`);
    if (r.status !== 200 || !Array.isArray(r.json)) throw new HttpError(502, 'db_error', 'Không đọc được hàng chờ.');
    return ok(res, { submissions: r.json });
  }
  const b = await readJson(req, 5000);
  const id = String(b.id || ''), status = b.action === 'applied' ? 'applied' : b.action === 'rejected' ? 'rejected' : '';
  if (!/^[0-9a-f-]{36}$/i.test(id) || !status) throw new HttpError(400, 'bad_request', 'Yêu cầu không hợp lệ.');
  const r = await rest('PATCH', `intake_submissions?id=eq.${id}&status=eq.pending`, { body: { status, reviewed_by: user.email, reviewed_at: new Date().toISOString() }, prefer: 'return=representation' });
  if (r.status >= 300 || !Array.isArray(r.json)) throw new HttpError(502, 'db_error', 'Không cập nhật được hàng chờ.');
  if (!r.json.length) throw new HttpError(409, 'already_reviewed', 'Mục này đã được người khác xử lý.');
  ok(res, { ok: true, status });
});
