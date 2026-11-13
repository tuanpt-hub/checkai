import { route, ok, allowMethods, readJson, HttpError } from '../_lib/util.js';
import { requireUser } from '../_lib/auth.js';
import { rest } from '../_lib/supabase.js';

const ID = /^[A-Za-z0-9_-]{3,64}$/;
const MAX_JSON = 3_500_000;

export default route(async (req, res) => {
  allowMethods(req, ['GET', 'PUT', 'DELETE']);
  const user = await requireUser(req, res);
  const id = String((req.query && req.query.id) || '');
  if (!ID.test(id)) throw new HttpError(400, 'bad_id', 'Mã audit không hợp lệ.');
  const eid = encodeURIComponent(id);

  if (req.method === 'GET') {
    const r = await rest('GET', `audits?id=eq.${eid}&select=data,version,updated_at,updated_by`);
    if (r.status !== 200 || !Array.isArray(r.json)) throw new HttpError(502, 'db_error', 'Không đọc được audit.');
    if (!r.json.length) throw new HttpError(404, 'not_found', 'Không tìm thấy audit.');
    const row = r.json[0];
    return ok(res, { audit: row.data, version: row.version, updated_at: row.updated_at, updated_by: row.updated_by });
  }

  if (req.method === 'DELETE') {
    const r = await rest('DELETE', `audits?id=eq.${eid}`, { prefer: 'return=minimal' });
    if (r.status >= 300) throw new HttpError(502, 'db_error', 'Không xóa được audit.');
    return ok(res, { ok: true });
  }

  // PUT: tạo mới (base rỗng) hoặc cập nhật có kiểm tra phiên bản
  const b = await readJson(req, MAX_JSON + 200_000);
  const data = b.data;
  if (!data || typeof data !== 'object' || Array.isArray(data) || typeof data.profile !== 'object' || data.id !== id)
    throw new HttpError(400, 'bad_data', 'Dữ liệu audit không hợp lệ.');
  if (JSON.stringify(data).length > MAX_JSON) throw new HttpError(413, 'too_large', 'Audit quá lớn.');
  const meta = b.meta || {};
  const row = {
    brand: String(meta.brand || data.profile.brand || '').slice(0, 200),
    score: Number.isFinite(Number(meta.score)) ? Math.max(-1, Math.min(100, Math.round(Number(meta.score)))) : -1,
    level: String(meta.level || '').slice(0, 40),
    data,
    updated_by: user.email,
  };
  const base = b.base == null ? null : Number(b.base);

  if (base == null) {
    const r = await rest('POST', 'audits', { body: { id, version: 1, ...row }, prefer: 'return=representation' });
    if (r.status === 409 || (r.json && r.json.code === '23505'))
      throw new HttpError(409, 'conflict', 'Audit này đã tồn tại trên máy chủ.', { version: null });
    if (r.status >= 300 || !Array.isArray(r.json) || !r.json.length) throw new HttpError(502, 'db_error', 'Không lưu được audit.');
    return ok(res, { version: r.json[0].version, updated_at: r.json[0].updated_at });
  }

  const r = await rest('PATCH', `audits?id=eq.${eid}&version=eq.${base}`, {
    body: { ...row, version: base + 1, updated_at: new Date().toISOString() },
    prefer: 'return=representation',
  });
  if (r.status >= 300 || !Array.isArray(r.json)) throw new HttpError(502, 'db_error', 'Không lưu được audit.');
  if (!r.json.length) {
    const cur = await rest('GET', `audits?id=eq.${eid}&select=version,updated_by`);
    const c = Array.isArray(cur.json) && cur.json[0];
    if (!c) throw new HttpError(404, 'not_found', 'Audit không còn trên máy chủ.');
    throw new HttpError(409, 'conflict', 'Người khác vừa cập nhật audit này.', { version: c.version, by: c.updated_by });
  }
  ok(res, { version: r.json[0].version, updated_at: r.json[0].updated_at });
});
