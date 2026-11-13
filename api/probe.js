import { route, ok, allowMethods, readJson, HttpError } from './_lib/util.js';
import { requireUser } from './_lib/auth.js';
import { ask, configured, PROBE_SYSTEM } from './_lib/providers.js';
import { bump } from './_lib/usage.js';

const ENGINES = ['claude', 'openai', 'gemini'];

/** Hỏi MỘT câu hỏi tới MỘT AI (cuộc trò chuyện mới, không lịch sử). */
export default route(async (req, res) => {
  allowMethods(req, ['POST']);
  const user = await requireUser(req, res);
  const b = await readJson(req, 20_000);
  const engine = String(b.engine || '');
  const prompt = String(b.prompt || '').trim();
  const web = b.web !== false;
  if (!ENGINES.includes(engine)) throw new HttpError(400, 'bad_engine', 'AI không được hỗ trợ.');
  if (prompt.length < 3 || prompt.length > 2000) throw new HttpError(400, 'bad_prompt', 'Câu hỏi phải dài 3–2000 ký tự.');
  if (!configured()[engine]) throw new HttpError(503, 'not_configured', 'AI này chưa được cấu hình khóa API.');

  const { used, limit } = await bump(user.email, 1);
  const deadline = Date.now() + 100_000;
  const r = await ask(engine, { prompt, system: PROBE_SYSTEM, web, maxTokens: 1500, deadline });
  ok(res, { ...r, text: r.text.slice(0, 8000), sources: r.sources.slice(0, 20), queries: r.queries.slice(0, 10), used, limit });
});
