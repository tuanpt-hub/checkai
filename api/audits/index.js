import { route, ok, allowMethods, HttpError } from '../_lib/util.js';
import { requireUser } from '../_lib/auth.js';
import { rest } from '../_lib/supabase.js';

export default route(async (req, res) => {
  allowMethods(req, ['GET']);
  await requireUser(req, res);
  const r = await rest('GET', 'audits?select=id,brand,score,level,version,updated_at,updated_by&order=updated_at.desc&limit=300');
  if (r.status !== 200 || !Array.isArray(r.json)) throw new HttpError(502, 'db_error', 'Không đọc được danh sách audit.');
  ok(res, { audits: r.json });
});
