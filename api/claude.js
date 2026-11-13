import { selectedModel } from './_lib/model-options.js';
import { route, ok, allowMethods, readJson, HttpError, extractJSON } from './_lib/util.js';
import { requireUser } from './_lib/auth.js';
import { askClaude, configured, MODELS } from './_lib/providers.js';
import { bump } from './_lib/usage.js';

/** Claude làm giám khảo và người viết (chấm câu trả lời, phân tích, viết tóm tắt…). Không dùng tìm kiếm web. */
export default route(async (req, res) => {
  allowMethods(req, ['POST']);
  const user = await requireUser(req, res);
  const b = await readJson(req, 300_000);
  const prompt = String(b.prompt || '');
  if (prompt.length < 3 || prompt.length > 120_000) throw new HttpError(400, 'bad_prompt', 'Nội dung quá ngắn hoặc quá dài.');
  if (!configured().claude) throw new HttpError(503, 'not_configured', 'Chưa cấu hình AI_GATEWAY_API_KEY hoặc ANTHROPIC_API_KEY.');
  const maxTokens = Math.min(Math.max(parseInt(b.maxTokens, 10) || 2000, 200), 6000);

  const model = selectedModel('judge', b.model, MODELS());
  const { used, limit } = await bump(user.email, 1);
  const r = await askClaude({ prompt, web: false, maxTokens, model, deadline: Date.now() + 100_000 });
  if (r.truncated) throw new HttpError(502, 'output_limit', 'Claude đã dùng hết giới hạn token; kết quả chưa hoàn chỉnh. Giảm số câu trong lô chấm hoặc chọn model giám khảo Haiku 5.5.', { model: r.model });
  if (b.json) {
    const parsed = extractJSON(r.text);
    if (parsed === null) throw new HttpError(502, 'invalid_json', 'Claude trả về sai định dạng JSON.');
    return ok(res, { json: parsed, model: r.model, used, limit });
  }
  ok(res, { text: r.text, model: r.model, used, limit });
});
