import crypto from 'node:crypto';
// Máy chủ giả lập Supabase, Anthropic, OpenAI, Gemini để kiểm thử cục bộ – KHÔNG dùng khóa thật.
import http from 'node:http';

const readBody = async (req) => { const c = []; for await (const x of req) c.push(x); const s = Buffer.concat(c).toString(); try { return s ? JSON.parse(s) : {}; } catch { return {}; } };
const send = (res, status, obj, headers = {}) => { res.writeHead(status, { 'Content-Type': 'application/json', ...headers }); res.end(obj === undefined ? '' : JSON.stringify(obj)); };
const hash = (s) => [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);

export const calls = { anthropic: 0, openai: 0, gemini: 0, supabaseRest: 0 };
export const USERS = { 'staff@netspace.vn': 'Mat-khau-1', 'outsider@gmail.com': 'Mat-khau-2' };

function answerFor(prompt) {
  const mention = hash(prompt) % 3 !== 0;
  return mention ? `NetSpace là công ty công nghệ và truyền thông tại Việt Nam, vận hành mạng lưới kênh và KOL. (trả lời giả lập)` : `Có nhiều đơn vị như Dinos, UpBase và Melive. (trả lời giả lập)`;
}
function judgeJSON(prompt) {
  const ids = [...prompt.matchAll(/\[([BCTS]\d+(?:\.\d+)?)\]/g)].map((m) => m[1]);
  const isB = prompt.includes('"knows"');
  const answerOf = (id) => { const i = prompt.indexOf('[' + id + ']'); const rest = prompt.slice(i + id.length + 2); const j = rest.search(/\n\n\[[BCTS]\d/); return (j < 0 ? rest : rest.slice(0, j)).split('Trả lời:')[1] || ''; };
  return JSON.stringify(ids.map((id) => {
    if (isB) return { id, knows: true, code: 2, accuracy: 3, confused_with: '', evidence: 'NetSpace là công ty công nghệ', note: 'Mô tả đúng cơ bản' };
    const on = /NetSpace/.test(answerOf(id));
    return { id, mentioned: on, code: on ? 2 : 0, evidence: on ? 'NetSpace là công ty công nghệ và truyền thông' : '', note: on ? 'Được nhắc' : 'Không nhắc',
      brands: on ? [{ name: 'Dinos', rank: 1, sentiment: 'tich_cuc' }, { name: 'NetSpace', rank: 2, sentiment: 'trung_tinh' }] : [{ name: 'Dinos', rank: 1, sentiment: 'tich_cuc' }, { name: 'UpBase', rank: 2 }, { name: 'Melive', rank: 3 }] };
  }));
}
function blueprintJSON(prompt) {
  const part = prompt.slice(prompt.indexOf('TIÊU CHÍ ĐÒN BẨY'), prompt.indexOf('Yêu cầu:'));
  const ids = [...part.matchAll(/^- (\d\.\d) /gm)].map((m) => m[1]);
  return JSON.stringify({ hien_trang: 'Hiện trạng giả lập dựa trên dữ kiện.', rui_ro: 'AI tiếp tục mô tả sai (giả lập).', thay_doi: [
    { tang: 'quy_trinh', tu: 'Chưa có quy trình', sang: 'Có quy trình duyệt hằng tháng', criteria: [ids[0]], can_cu: 'Dữ kiện giả lập cho ' + ids[0], viec_dau_tien: 'Họp chốt quy trình', phu_trach: 'Lãnh đạo' },
    { tang: 'tai_san', tu: 'Thiếu tài sản', sang: 'Có tài sản chuẩn', criteria: [ids[1] || ids[0]], can_cu: 'Dữ kiện giả lập', viec_dau_tien: 'Soạn bản nháp', phu_trach: 'Brand' },
    { tang: 'he_thong', tu: 'x', sang: 'y', criteria: ['9.9'], can_cu: 'mã không tồn tại – phải bị loại' },
    { tang: 'con_nguoi', tu: 'x', sang: 'y', criteria: [ids[0]], can_cu: '' }] });
}
function itemsJSON(prompt) {
  if (prompt.includes('"ly_do"')) return JSON.stringify({ items: [{ name: 'Dinos', ly_do: 'MCN lớn tại Việt Nam' }, { name: 'Yeah1', ly_do: 'Mạng lưới nội dung số' }, { name: 'METUB', ly_do: 'MCN đa nền tảng' }] });
  const n = prompt.includes('20 tình huống') ? 20 : 10;
  return JSON.stringify({ items: Array.from({ length: n }, (_, i) => (n === 20 ? 'Tình huống mua hàng gợi ý ' : 'Chủ đề gợi ý ') + (i + 1)) });
}
function scoreJSON(prompt) {
  const part = prompt.slice(prompt.indexOf('TIÊU CHÍ CẦN CHẤM'), prompt.indexOf('DỮ KIỆN:'));
  const ids = [...part.matchAll(/^- (\d\.\d) /gm)].map((m) => m[1]);
  return JSON.stringify(ids.map((id) => (/\.[45]$/.test(id) ? { id, score: null, confidence: 'thap', reason: 'Không đủ dữ kiện', missing: 'Cần dữ liệu bên ngoài (giả lập)' } : { id, score: 2, confidence: 'trung_binh', reason: 'Căn cứ giả lập từ dữ kiện', missing: '' })));
}
function planJSON() {
  return JSON.stringify({ items: [
    { title: 'Mở quyền cho bot tìm kiếm AI', criteria: ['1.1'], why: 'GPTBot bị chặn (giả lập).', steps: ['Sửa robots.txt', 'Mở tường lửa'], owner: 'Tech', effort: 'Nhỏ', impact: 'Cao', timeframe: '0–30 ngày', kpi: 'Quét lại: 0 bot bị chặn' },
    { title: 'Chuẩn hóa tên gọi', criteria: ['2.1', '4.6'], why: 'Nhiều biến thể tên (giả lập).', steps: ['Ban hành Brand Truth Sheet'], owner: 'Brand', effort: 'Vừa', impact: 'Cao', timeframe: '31–60 ngày', kpi: 'Tỷ lệ AI nhắc khi hỏi tên' }] });
}
function variantsJSON(prompt) {
  const out = {};
  for (const m of prompt.matchAll(/^S(\d+): (.+)$/gm)) out['S' + m[1]] = ['Cách hỏi ngắn: ' + m[2].slice(0, 40), 'nhờ gợi ý giúp: ' + m[2].slice(0, 40)];
  return JSON.stringify(out);
}
const CLAIM_SOURCES = [{ url: 'https://kol.gov.vn/gioi-thieu', title: 'KOL' }, { url: 'https://vtv.vn/bai-viet', title: 'VTV' }];
function claimJSON() {
  return JSON.stringify({ sources: [
    { url: 'https://kol.gov.vn/gioi-thieu', ten_nguon: 'kol.gov.vn', loai: 'co_quan_nha_nuoc', doc_lap: true, xac_nhan: true },
    { url: 'https://vtv.vn/bai-viet', ten_nguon: 'VTV', loai: 'bao_chi_tu_viet', doc_lap: true, xac_nhan: true },
    { url: 'https://khong-ton-tai.vn/bia', ten_nguon: 'Bịa', loai: 'bao_chi_tu_viet', doc_lap: true, xac_nhan: true } ], mau_thuan: '', ghi_chu: 'giả lập' });
}

/** Website và Wikidata giả cho chức năng quét (chỉ dùng khi chạy thử). */
export function startFakeSite(port = 0) {
  const page = (body, ld = '') => `<!doctype html><html lang="vi"><head><title>NetSpace giả lập</title><meta name="description" content="Công ty công nghệ và truyền thông">${ld}</head><body>${body}</body></html>`;
  const s = http.createServer((req, res) => {
    const ua = req.headers['user-agent'] || '';
    if (/GPTBot/.test(ua)) { res.writeHead(403); return res.end('blocked'); }
    if (req.url === '/robots.txt') { res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end('User-agent: GPTBot\nDisallow: /\n\nUser-agent: *\nAllow: /\n'); }
    if (req.url === '/sitemap.xml') { res.writeHead(200, { 'Content-Type': 'application/xml' }); return res.end('<urlset><url><loc>/a</loc><lastmod>2026-11-02</lastmod></url><url><loc>/b</loc></url></urlset>'); }
    if (req.url === '/gioi-thieu') { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end(page('<h1>Giới thiệu</h1><p>Tầng 3, 229 Tây Sơn. Mã số thuế 0109.</p>')); }
    if (req.url === '/') { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end(page(`<h1>NetSpace</h1><p>${'Nền tảng truyền thông số. '.repeat(60)}</p><a href="/gioi-thieu">Giới thiệu</a><a href="https://facebook.com/netspaceco">FB</a><a href="tel:0900000000">Gọi</a><p>Nhận tư vấn</p>`, '<script type="application/ld+json">{"@type":"Organization","name":"NetSpace","url":"https://netspace.vn"}</script>')); }
    res.writeHead(404); res.end('<html>404</html>');
  });
  return new Promise((r) => s.listen(port, '127.0.0.1', () => r(s)));
}
export function startFakeWiki() {
  const s = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x'); res.writeHead(200, { 'Content-Type': 'application/json' });
    if (u.searchParams.get('action') === 'wbsearchentities') return res.end(JSON.stringify({ search: [{ id: 'Q900' }, { id: 'Q901' }] }));
    res.end(JSON.stringify({ entities: { Q900: { id: 'Q900', labels: { vi: { value: 'NetSpace' } }, descriptions: { vi: { value: 'công ty truyền thông Việt Nam' } }, claims: { P856: [{ mainsnak: { datavalue: { value: 'https://netspace.vn' } } }] }, sitelinks: {} },
      Q901: { id: 'Q901', labels: { en: { value: 'Netspace' } }, descriptions: { en: { value: 'telecommunications company in Angola' } }, claims: {}, sitelinks: {} } } }));
  });
  return new Promise((r) => s.listen(0, '127.0.0.1', () => r(s)));
}

export async function startFakes() {
  const db = { audits: new Map(), usage: new Map(), sessions: new Map(), intake_links: new Map(), intake_submissions: new Map(), leads: new Map(), health_checks: new Map(), health_check_answers: new Map() };

  const supabase = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const p = url.pathname;
    if (!req.headers.apikey) return send(res, 401, { message: 'No API key' });
    if (p === '/auth/v1/token') {
      const b = await readBody(req);
      const g = url.searchParams.get('grant_type');
      if (g === 'password') {
        if (USERS[b.email] && USERS[b.email] === b.password) {
          const at = 'at_' + b.email + '_' + Date.now(); const rt = 'rt_' + b.email;
          db.sessions.set(at, b.email); db.sessions.set(rt, b.email);
          return send(res, 200, { access_token: at, refresh_token: rt, expires_in: 3600, user: { email: b.email, id: 'u_' + b.email } });
        }
        return send(res, 400, { error_code: 'invalid_credentials', msg: 'Invalid login credentials' });
      }
      if (g === 'refresh_token') {
        const email = db.sessions.get(b.refresh_token);
        if (!email) return send(res, 400, { error_code: 'refresh_token_not_found' });
        const at = 'at_' + email + '_' + Date.now(); db.sessions.set(at, email);
        return send(res, 200, { access_token: at, refresh_token: b.refresh_token, expires_in: 3600, user: { email, id: 'u_' + email } });
      }
    }
    if (p === '/auth/v1/user') {
      const t = (req.headers.authorization || '').replace('Bearer ', '');
      const email = db.sessions.get(t);
      return email ? send(res, 200, { email, id: 'u_' + email }) : send(res, 401, { msg: 'bad jwt' });
    }
    if (p === '/auth/v1/logout') { const t = (req.headers.authorization || '').replace('Bearer ', ''); db.sessions.delete(t); return send(res, 204); }
    if (p.startsWith('/rest/v1/')) {
      calls.supabaseRest++;
      const k = req.headers.apikey;
      if (!k.startsWith('sb_secret_') && !k.startsWith('eyJ')) return send(res, 401, { message: 'secret key required' });
      if (k.startsWith('sb_secret_') && req.headers.authorization) return send(res, 401, { message: 'Invalid JWT' }); // khóa mới không được gửi ở Authorization
      const rest = p.slice('/rest/v1/'.length);
      if (rest === 'intake_links' || rest === 'intake_submissions') {
        // Bảng chung kiểu PostgREST: lọc col=eq.x / lt.x, sắp xếp, chèn, sửa.
        const t = db[rest];
        const filters = [...url.searchParams].filter(([k]) => !['select', 'order', 'limit'].includes(k)).map(([k, v]) => [k, v.slice(0, v.indexOf('.')), v.slice(v.indexOf('.') + 1)]);
        const match = (row) => filters.every(([k, op, val]) => (op === 'eq' ? String(row[k]) === val : op === 'lt' ? Number(row[k]) < Number(val) : true));
        if (req.method === 'GET') {
          let rows = [...t.values()].filter(match);
          const ord = url.searchParams.get('order'); if (ord) { const [col, dir] = ord.split('.'); rows.sort((a, b) => (String(a[col]) < String(b[col]) ? -1 : 1) * (dir === 'desc' ? -1 : 1)); }
          return send(res, 200, rows.slice(0, Number(url.searchParams.get('limit')) || 1000));
        }
        if (req.method === 'POST') {
          const b = await readBody(req);
          if (!db.audits.has(b.audit_id)) return send(res, 409, { code: '23503', message: 'foreign key violation' });
          if (rest === 'intake_links' && [...t.values()].some((r) => r.token_hash === b.token_hash)) return send(res, 409, { code: '23505' });
          const row = rest === 'intake_links' ? { id: crypto.randomUUID(), created_at: new Date().toISOString(), revoked: false, ai_calls: 0, submissions: 0, last_used_at: null, ...b }
            : { id: crypto.randomUUID(), submitted_at: new Date().toISOString(), status: 'pending', reviewed_by: null, reviewed_at: null, ...b };
          t.set(row.id, row); return send(res, 201, [row]);
        }
        if (req.method === 'PATCH') {
          const b = await readBody(req); const rows = [...t.values()].filter(match); rows.forEach((r) => Object.assign(r, b)); return send(res, 200, rows);
        }
      }
      if (['leads', 'health_checks', 'health_check_answers'].includes(rest)) {
        // Bảng kiểu PostgREST cho đợt A: lọc eq/gte/lt/in, sắp xếp, giới hạn, chèn (bỏ qua trùng), sửa trả bản ghi.
        const t = db[rest];
        const filters = [...url.searchParams].filter(([k]) => !['select', 'order', 'limit'].includes(k)).map(([k, v]) => [k, v.slice(0, v.indexOf('.')), v.slice(v.indexOf('.') + 1)]);
        const val = (row, k) => (row[k] === null || row[k] === undefined ? '' : String(row[k]));
        const match = (row) => filters.every(([k, op, v]) => op === 'eq' ? val(row, k) === v : op === 'gte' ? val(row, k) >= v : op === 'lt' ? val(row, k) < v
          : op === 'in' ? v.replace(/^\(|\)$/g, '').split(',').includes(val(row, k)) : true);
        if (req.method === 'GET') {
          let rows = [...t.values()].filter(match);
          const ord = url.searchParams.get('order'); if (ord) { const [col, dir] = ord.split('.'); rows.sort((a, b) => (val(a, col) < val(b, col) ? -1 : 1) * (dir === 'desc' ? -1 : 1)); }
          return send(res, 200, rows.slice(0, Number(url.searchParams.get('limit')) || 1000).map((r) => ({ ...r })));
        }
        if (req.method === 'POST') {
          const b = await readBody(req);
          if (rest === 'health_check_answers' && [...t.values()].some((r) => r.hc_id === b.hc_id && r.qid === b.qid && r.engine === b.engine))
            return (req.headers.prefer || '').includes('ignore-duplicates') ? send(res, 201, []) : send(res, 409, { code: '23505' });
          if (rest === 'health_checks' && b.verify_hash && [...t.values()].some((r) => r.verify_hash === b.verify_hash)) return send(res, 409, { code: '23505' });
          const now = new Date().toISOString();
          const row = { id: crypto.randomUUID(), created_at: now, ...(rest === 'leads' ? { updated_at: now, status: 'new', utm: {} } : rest === 'health_checks' ? { status: 'pending', calls_used: 0, calls_limit: 0, engines: [] } : { sources: [] }), ...b };
          t.set(row.id, row); return send(res, 201, [row]);
        }
        if (req.method === 'PATCH') {
          const b = await readBody(req); const rows = [...t.values()].filter(match); rows.forEach((r) => Object.assign(r, b)); return send(res, 200, rows.map((r) => ({ ...r })));
        }
      }
      if (rest === 'rpc/hc_report_view') {
        const b = await readBody(req); const h = [...db.health_checks.values()].find((r) => r.report_token === b.p_token && r.status === 'done');
        if (!h) return send(res, 200, []);
        db.report_views = db.report_views || [];
        if (db.report_views.some((v) => v.hc_id === h.id && v.ip_hash === b.p_ip && Date.now() - v.at < 30 * 60_000)) return send(res, 200, [{ o_counted: false, o_views: h.view_count || 0 }]);
        db.report_views.push({ hc_id: h.id, ip_hash: b.p_ip, device: b.p_device, at: Date.now() });
        h.view_count = (h.view_count || 0) + 1; h.last_viewed_at = new Date().toISOString(); h.first_viewed_at = h.first_viewed_at || h.last_viewed_at;
        return send(res, 200, [{ o_counted: true, o_views: h.view_count }]);
      }
      if (rest === 'rpc/hc_take_call') {
        const b = await readBody(req); const r = db.health_checks.get(b.p_id);
        if (!r || r.status !== 'running' || r.calls_used >= r.calls_limit || Date.parse(r.session_expires_at) < Date.now()) return send(res, 200, null);
        r.calls_used++; return send(res, 200, r.calls_used);
      }
      if (rest === 'rpc/bump_usage') {
        const b = await readBody(req); const key = b.p_email.toLowerCase() + '|' + b.p_day;
        const n = (db.usage.get(key) || 0) + b.p_n; db.usage.set(key, n); return send(res, 200, n);
      }
      if (rest === 'usage') {
        const email = (url.searchParams.get('email') || '').replace('eq.', ''); const day = (url.searchParams.get('day') || '').replace('eq.', '');
        const n = db.usage.get(email + '|' + day); return send(res, 200, n === undefined ? [] : [{ calls: n }]);
      }
      if (rest === 'audits') {
        const idq = (url.searchParams.get('id') || '').replace('eq.', ''); const vq = url.searchParams.get('version');
        if (req.method === 'GET') {
          let rows = [...db.audits.values()];
          if (idq) rows = rows.filter((r) => r.id === idq);
          return send(res, 200, rows.map((r) => ({ ...r })));
        }
        if (req.method === 'POST') {
          const b = await readBody(req);
          if (db.audits.has(b.id)) return send(res, 409, { code: '23505', message: 'duplicate key' });
          const row = { ...b, updated_at: new Date().toISOString() }; db.audits.set(b.id, row); return send(res, 201, [row]);
        }
        if (req.method === 'PATCH') {
          const b = await readBody(req); const row = db.audits.get(idq);
          if (!row || (vq && row.version !== Number(vq.replace('eq.', '')))) return send(res, 200, []);
          Object.assign(row, b); return send(res, 200, [row]);
        }
        if (req.method === 'DELETE') { db.audits.delete(idq); return send(res, 204); }
      }
    }
    send(res, 404, { message: 'unknown ' + p });
  });

  const anthropic = http.createServer(async (req, res) => {
    anthropic.calls = (anthropic.calls || 0) + 1; calls.anthropic++;
    if (req.headers['x-api-key'] !== 'test-anthropic') return send(res, 401, { error: { message: 'invalid x-api-key' } });
    const b = await readBody(req); const prompt = String(b.messages[0].content);
    if (b.tools && prompt.includes('kiểm chứng viên')) {
      return send(res, 200, { stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 20, server_tool_use: { web_search_requests: 1 } }, content: [
        { type: 'server_tool_use', id: 's1', name: 'web_search', input: { query: 'kiểm chứng' } },
        { type: 'web_search_tool_result', tool_use_id: 's1', content: CLAIM_SOURCES.map((x) => ({ type: 'web_search_result', ...x })) },
        { type: 'text', text: claimJSON() }] });
    }
    if (b.tools) {
      return send(res, 200, { stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 20, server_tool_use: { web_search_requests: 1 } }, content: [
        { type: 'text', text: 'Để tôi tìm kiếm.' },
        { type: 'server_tool_use', id: 's1', name: 'web_search', input: { query: 'NetSpace công ty' } },
        { type: 'web_search_tool_result', tool_use_id: 's1', content: [{ type: 'web_search_result', url: 'https://vtv.vn/a', title: 'VTV' }, { type: 'web_search_result', url: 'https://znews.vn/b', title: 'Znews' }] },
        { type: 'text', text: answerFor(prompt), citations: [{ type: 'web_search_result_location', url: 'https://vtv.vn/a', title: 'VTV' }] }] });
    }
    const text = prompt.includes('"tang"') ? blueprintJSON(prompt) : prompt.includes('Viết lại mỗi tình huống') ? variantsJSON(prompt) : prompt.includes('"timeframe"') ? planJSON(prompt) : prompt.includes('"confidence"') ? scoreJSON(prompt) : prompt.includes('{"items"') ? itemsJSON(prompt) : prompt.includes('JSON') ? judgeJSON(prompt) : 'Văn bản do Claude viết (giả lập).';
    send(res, 200, { stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 20 }, content: [{ type: 'text', text: prompt.includes('JSON') ? '```json\n' + text + '\n```' : text }] });
  });

  const openai = http.createServer(async (req, res) => {
    calls.openai++;
    if (req.headers.authorization !== 'Bearer test-openai') return send(res, 401, { error: { message: 'Incorrect API key' } });
    const b = await readBody(req);
    if (!b.tools) { const p = String(b.input); const t = p.includes('JSON') ? judgeJSON(p) : 'Văn bản do ChatGPT viết (giả lập).'; return send(res, 200, { status: 'completed', usage: { input_tokens: 5, output_tokens: 9 }, output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: t, annotations: [] }] }] }); }
    if (b.tools?.[0]?.type !== 'web_search' || b.tools[0].user_location?.country !== 'VN') return send(res, 400, { error: { message: 'bad tools' } });
    send(res, 200, { status: 'completed', usage: { input_tokens: 5, output_tokens: 9 }, output: [
      { type: 'web_search_call', id: 'w1', status: 'completed', action: { type: 'search', query: 'NetSpace', sources: [{ type: 'url', url: 'https://kol.gov.vn/x' }] } },
      { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: answerFor(String(b.input)), annotations: [{ type: 'url_citation', url: 'https://vnexpress.net/y', title: 'VnExpress' }] }] }] });
  });

  const gemini = http.createServer(async (req, res) => {
    calls.gemini++;
    if (req.headers['x-goog-api-key'] !== 'test-gemini') return send(res, 403, { error: { message: 'API key not valid' } });
    const b = await readBody(req);
    if (!b.tools) { const p = b.contents[0].parts[0].text; const t = p.includes('JSON') ? judgeJSON(p) : 'Văn bản do Gemini viết (giả lập).'; return send(res, 200, { usageMetadata: {}, candidates: [{ finishReason: 'STOP', content: { parts: [{ text: t }] } }] }); }
    if (!b.tools?.[0]?.google_search) return send(res, 400, { error: { message: 'no grounding' } });
    send(res, 200, { usageMetadata: { promptTokenCount: 4, candidatesTokenCount: 8 }, candidates: [{ finishReason: 'STOP',
      content: { parts: [{ text: answerFor(b.contents[0].parts[0].text) }] },
      groundingMetadata: { webSearchQueries: ['netspace'], groundingChunks: [{ web: { uri: 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc', title: 'tuoitre.vn' } }] } }] });
  });

  const listen = (s) => new Promise((r) => s.listen(0, '127.0.0.1', () => r(s.address().port)));
  const ports = { supabase: await listen(supabase), anthropic: await listen(anthropic), openai: await listen(openai), gemini: await listen(gemini) };
  return { ports, db, close: () => [supabase, anthropic, openai, gemini].forEach((s) => s.close()) };
}

/** Turnstile, Resend, Telegram giả: ghi lại mọi yêu cầu để kiểm thử. */
export async function startFakeNotify() {
  const sent = { emails: [], telegram: [], captcha: [] };
  const s = http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x'); const b = req.method === 'POST' ? await readBody(req) : null;
    if (u.pathname === '/turnstile') { sent.captcha.push(b); return send(res, 200, { success: b && b.secret === 'test-turnstile-secret' && b.response === 'ok-token' }); }
    if (u.pathname === '/emails') { if (req.headers.authorization !== 'Bearer test-resend') return send(res, 401, { message: 'bad key' }); sent.emails.push(b); return send(res, 200, { id: 'em_' + sent.emails.length }); }
    if (u.pathname === '/last-email') return send(res, 200, sent.emails.at(-1) || null);
    if (/^\/bot[^/]+\/sendMessage$/.test(u.pathname)) { sent.telegram.push({ path: u.pathname, ...b }); return send(res, 200, { ok: true }); }
    send(res, 404, {});
  });
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${s.address().port}`;
  return { server: s, sent, env: { TURNSTILE_VERIFY_URL: base + '/turnstile', RESEND_API_URL: base + '/emails', RESEND_API_KEY: 'test-resend', TELEGRAM_API_BASE: base, TELEGRAM_BOT_TOKEN: 'test-bot', TELEGRAM_CHAT_ID: '-100123', SALES_EMAILS: 'sales@netspace.vn' }, base };
}
