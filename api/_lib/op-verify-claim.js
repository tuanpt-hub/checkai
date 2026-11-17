import { route, ok, allowMethods, readJson, HttpError, extractJSON } from './util.js';
import { requireUser } from './auth.js';
import { ask, configured, MODELS } from './providers.js';
import { selectedModel } from './model-options.js';
import { bump } from './usage.js';

const TYPES = ['co_quan_nha_nuoc', 'bao_chi_tu_viet', 'bai_pr_thong_cao', 'website_thuong_hieu', 'doi_tac_khach_hang', 'mang_xa_hoi', 'danh_ba_khac'];
const key = u => { try { const x = new URL(u); return (x.hostname.replace(/^www\./, '') + x.pathname.replace(/\/+$/, '')).toLowerCase(); } catch { return ''; } };

/** Kiểm chứng một claim bằng tìm kiếm web; chỉ giữ nguồn có trong kết quả tìm kiếm thật (chống bịa nguồn). */
export default route(async (req, res) => {
  allowMethods(req, ['POST']);
  const user = await requireUser(req, res);
  const b = await readJson(req, 20_000);
  const claim = String(b.claim || '').trim(), brand = String(b.brand || '').trim().slice(0, 120), website = String(b.website || '').trim().slice(0, 200);
  if (claim.length < 5 || claim.length > 500) throw new HttpError(400, 'bad_claim', 'Claim phải dài 5–500 ký tự.');
  const engine = ['claude', 'openai'].includes(b.engine) ? b.engine : 'claude';
  if (!configured()[engine]) throw new HttpError(503, 'not_configured', 'AI dùng để kiểm chứng chưa được cấu hình.');
  const model = selectedModel(engine, b.model, MODELS());
  const used = await bump(user.email, 1);
  const prompt = `Bạn là kiểm chứng viên độc lập. Hãy TÌM KIẾM WEB để kiểm chứng tuyên bố sau của thương hiệu "${brand}" (website: ${website || 'không rõ'}):
"${claim}"

Tìm các nguồn nói về đúng nội dung này. Với mỗi nguồn đã đọc, phân loại:
- loai: một trong ${TYPES.join(', ')}
- doc_lap: true nếu nguồn KHÔNG do thương hiệu viết, KHÔNG phải bài PR trả tiền và KHÔNG chép lại thông cáo báo chí
- xac_nhan: true nếu nguồn thực sự xác nhận nội dung tuyên bố (không chỉ nhắc tên thương hiệu)
Chỉ liệt kê nguồn bạn đã thực sự mở hoặc thấy trong kết quả tìm kiếm; không tự tạo URL.
Chỉ trả về JSON: {"sources":[{"url":"...","ten_nguon":"...","loai":"...","doc_lap":true,"xac_nhan":true,"ghi_chu":"..."}],"mau_thuan":"mô tả ngắn nếu có nguồn nói khác, nếu không thì rỗng","ghi_chu":"một câu tiếng Việt"}`;
  const r = await ask(engine, { prompt, web: true, maxTokens: 3000, model, deadline: Date.now() + 100_000 });
  const parsed = extractJSON(r.text);
  if (!parsed || typeof parsed !== 'object') throw new HttpError(502, 'invalid_json', 'AI trả sai định dạng khi kiểm chứng.');
  const retrieved = new Set((r.sources || []).map(s => key(s.url)).filter(Boolean));
  const listed = Array.isArray(parsed.sources) ? parsed.sources.slice(0, 15) : [];
  const sources = [], dropped = [];
  for (const s of listed) {
    const u = String(s && s.url || '');
    if (!/^https?:\/\//i.test(u)) continue;
    const item = { url: u.slice(0, 500), name: String(s.ten_nguon || '').slice(0, 120), type: TYPES.includes(s.loai) ? s.loai : 'danh_ba_khac', independent: s.doc_lap === true, confirms: s.xac_nhan === true, note: String(s.ghi_chu || '').slice(0, 200) };
    if (retrieved.has(key(u))) sources.push(item); else dropped.push(item.url);
  }
  const brandHost = key(website).split('/')[0];
  for (const s of sources) if (brandHost && key(s.url).startsWith(brandHost)) { s.independent = false; s.type = 'website_thuong_hieu'; }
  const independent = sources.filter(s => s.independent && s.confirms).length;
  ok(res, { at: new Date().toISOString(), claim, engine, model: r.model || model, sources, independent, selfOnly: sources.filter(s => s.confirms && !s.independent).length,
    status: independent >= 2 ? 'Đã kiểm chứng' : independent === 1 ? 'Một nguồn' : sources.some(s => s.confirms) ? 'Tự công bố' : 'Không tìm thấy nguồn xác nhận',
    conflict: String(parsed.mau_thuan || '').slice(0, 300), note: String(parsed.ghi_chu || '').slice(0, 300), droppedUnverified: dropped.length, used: used.used, limit: used.limit });
});
