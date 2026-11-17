import { route, ok, allowMethods, readJson, HttpError } from './util.js';
import { rest } from './supabase.js';
import { bump } from './usage.js';
import { linkFromRequest, limitIp, cleanSubmission, AI_LIMIT, suggest } from './intake.js';

/** Gợi ý bằng AI trên form công khai. Giới hạn số lượt theo link; chi phí tính vào hạn mức của người tạo link. */
export default route(async (req, res) => {
  allowMethods(req, ['POST']);
  limitIp(req, 'intake-ai', 10, 10 * 60_000);
  const link = await linkFromRequest(req);
  const b = await readJson(req, 80_000);
  const kind = String(b.kind || '');
  if (!['topics', 'scenarios', 'competitors'].includes(kind)) throw new HttpError(400, 'bad_kind', 'Loại gợi ý không hợp lệ.');
  const used = link.ai_calls || 0;
  if (used >= AI_LIMIT()) throw new HttpError(429, 'ai_limit', 'Đã dùng hết lượt gợi ý bằng AI của link này.');
  const r = await rest('PATCH', `intake_links?id=eq.${link.id}&ai_calls=eq.${used}`, { body: { ai_calls: used + 1, last_used_at: new Date().toISOString() }, prefer: 'return=representation' });
  if (r.status >= 300 || !Array.isArray(r.json) || !r.json.length) throw new HttpError(409, 'busy', 'Đang xử lý một yêu cầu khác. Thử lại.');
  await bump(link.created_by, 1);
  const items = await suggest(kind, cleanSubmission(b).fields);
  ok(res, { items, aiLeft: Math.max(0, AI_LIMIT() - used - 1) });
});
