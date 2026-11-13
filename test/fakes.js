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
  const ids = [...prompt.matchAll(/\[([BCTS]\d+)\]/g)].map((m) => m[1]);
  const isB = prompt.includes('"knows"');
  return JSON.stringify(ids.map((id) => (isB ? { id, knows: true, code: 2, accuracy: 3, confused_with: '', note: 'Mô tả đúng cơ bản' } : { id, code: 2, note: 'Được nhắc' })));
}

export async function startFakes() {
  const db = { audits: new Map(), usage: new Map(), sessions: new Map() };

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
    if (b.tools) {
      return send(res, 200, { stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 20, server_tool_use: { web_search_requests: 1 } }, content: [
        { type: 'text', text: 'Để tôi tìm kiếm.' },
        { type: 'server_tool_use', id: 's1', name: 'web_search', input: { query: 'NetSpace công ty' } },
        { type: 'web_search_tool_result', tool_use_id: 's1', content: [{ type: 'web_search_result', url: 'https://vtv.vn/a', title: 'VTV' }, { type: 'web_search_result', url: 'https://znews.vn/b', title: 'Znews' }] },
        { type: 'text', text: answerFor(prompt), citations: [{ type: 'web_search_result_location', url: 'https://vtv.vn/a', title: 'VTV' }] }] });
    }
    const text = prompt.includes('JSON') ? judgeJSON(prompt) : 'Văn bản do Claude viết (giả lập).';
    send(res, 200, { stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 20 }, content: [{ type: 'text', text: prompt.includes('JSON') ? '```json\n' + text + '\n```' : text }] });
  });

  const openai = http.createServer(async (req, res) => {
    calls.openai++;
    if (req.headers.authorization !== 'Bearer test-openai') return send(res, 401, { error: { message: 'Incorrect API key' } });
    const b = await readBody(req);
    if (b.tools?.[0]?.type !== 'web_search' || b.tools[0].user_location?.country !== 'VN') return send(res, 400, { error: { message: 'bad tools' } });
    send(res, 200, { status: 'completed', usage: { input_tokens: 5, output_tokens: 9 }, output: [
      { type: 'web_search_call', id: 'w1', status: 'completed', action: { type: 'search', query: 'NetSpace', sources: [{ type: 'url', url: 'https://kol.gov.vn/x' }] } },
      { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: answerFor(String(b.input)), annotations: [{ type: 'url_citation', url: 'https://vnexpress.net/y', title: 'VnExpress' }] }] }] });
  });

  const gemini = http.createServer(async (req, res) => {
    calls.gemini++;
    if (req.headers['x-goog-api-key'] !== 'test-gemini') return send(res, 403, { error: { message: 'API key not valid' } });
    const b = await readBody(req);
    if (!b.tools?.[0]?.google_search) return send(res, 400, { error: { message: 'no grounding' } });
    send(res, 200, { usageMetadata: { promptTokenCount: 4, candidatesTokenCount: 8 }, candidates: [{ finishReason: 'STOP',
      content: { parts: [{ text: answerFor(b.contents[0].parts[0].text) }] },
      groundingMetadata: { webSearchQueries: ['netspace'], groundingChunks: [{ web: { uri: 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc', title: 'tuoitre.vn' } }] } }] });
  });

  const listen = (s) => new Promise((r) => s.listen(0, '127.0.0.1', () => r(s.address().port)));
  const ports = { supabase: await listen(supabase), anthropic: await listen(anthropic), openai: await listen(openai), gemini: await listen(gemini) };
  return { ports, db, close: () => [supabase, anthropic, openai, gemini].forEach((s) => s.close()) };
}
