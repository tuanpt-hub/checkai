import { HttpError, envInt } from './util.js';
import { rest, rpc } from './supabase.js';

export const dailyLimit = () => envInt('DAILY_CALL_LIMIT', 1500);
/** Ngày tính theo giờ Việt Nam (UTC+7). */
export const today = () => new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);

/** Cộng n lượt vào hạn mức của người dùng; ném 429 nếu vượt. Lỗi DB => từ chối (bảo vệ chi phí). */
export async function bump(email, n = 1) {
  const limit = dailyLimit();
  const r = await rpc('bump_usage', { p_email: email, p_day: today(), p_n: n });
  if (r.status >= 300) throw new HttpError(503, 'usage_unavailable', 'Không ghi được hạn mức sử dụng. Kiểm tra lại cơ sở dữ liệu.');
  const v = Array.isArray(r.json) ? Object.values(r.json[0] || {})[0] : r.json;
  const used = Number(v);
  if (!Number.isFinite(used)) throw new HttpError(503, 'usage_unavailable', 'Không đọc được hạn mức sử dụng.');
  if (used > limit) throw new HttpError(429, 'daily_limit', `Đã dùng hết hạn mức ${limit} lượt gọi AI trong ngày.`, { used, limit });
  return { used, limit };
}

export async function getUsage(email) {
  const r = await rest('GET', `usage?email=eq.${encodeURIComponent(email)}&day=eq.${today()}&select=calls`);
  if (r.status !== 200 || !Array.isArray(r.json)) return null;
  return r.json.length ? Number(r.json[0].calls) : 0;
}
