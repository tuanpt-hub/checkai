import assert from 'node:assert/strict';
import http from 'node:http';
import { startFakes, USERS } from './fakes.js';
import { startServer } from '../scripts/dev.js';
import { isPrivateIp, safeFetch, normalizeTarget } from '../api/_lib/safe-fetch.js';
import { parseRobots, robotsAllows, analyzeHtml, parseSitemap } from '../api/_lib/scan.js';

/* ---------- đơn vị: chống SSRF ---------- */
for (const ip of ['127.0.0.1', '10.1.2.3', '172.20.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1']) assert.ok(isPrivateIp(ip), ip);
for (const ip of ['8.8.8.8', '1.1.1.1', '2606:4700::1111']) assert.ok(!isPrivateIp(ip), ip);
assert.throws(() => normalizeTarget('ftp://x.com'), /http/); assert.throws(() => normalizeTarget('https://u:p@x.com'), /http/);
assert.throws(() => normalizeTarget('https://x.com:8080'), /cổng/); assert.equal(normalizeTarget('netspace.vn').href, 'https://netspace.vn/');
delete process.env.SCAN_ALLOW_PRIVATE;
await assert.rejects(safeFetch('http://127.0.0.1/'), /không được phép/);
process.env.SCAN_ALLOW_PRIVATE = '1'; process.env.VERCEL = '1';
await assert.rejects(safeFetch('http://127.0.0.1/'), /không được phép/, 'VERCEL=1 always blocks private hosts');
delete process.env.VERCEL;

/* ---------- đơn vị: robots.txt (RFC 9309) ---------- */
const rb = parseRobots(`User-agent: *\nDisallow: /private\nAllow: /private/ok$\n\nUser-agent: GPTBot\nUser-agent: CCBot\nDisallow: /\n\nUser-agent: PerplexityBot\nDisallow:\nSitemap: https://ex.com/sm.xml`);
assert.deepEqual(rb.sitemaps, ['https://ex.com/sm.xml']);
assert.equal(robotsAllows(rb, 'GPTBot').allowed, false); assert.equal(robotsAllows(rb, 'CCBot').allowed, false);
assert.equal(robotsAllows(rb, 'PerplexityBot').allowed, true, 'empty Disallow allows all');
assert.equal(robotsAllows(rb, 'ClaudeBot').matched, '*'); assert.equal(robotsAllows(rb, 'ClaudeBot', '/private/x').allowed, false);
assert.equal(robotsAllows(rb, 'ClaudeBot', '/private/ok').allowed, true, 'longest match + $ anchor'); assert.equal(robotsAllows(rb, 'ClaudeBot', '/private/ok/x').allowed, false);
assert.equal(robotsAllows(parseRobots(''), 'GPTBot').allowed, true);

/* ---------- đơn vị: HTML & sitemap ---------- */
const html = `<!doctype html><html lang="vi"><head><title>NetSpace | Truyền thông</title><meta name="description" content="Công ty công nghệ"><meta name="robots" content="index,follow">
<link rel="canonical" href="https://ex.com/"><script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"Organization","name":"NetSpace","url":"https://ex.com","logo":"x.png","sameAs":["https://facebook.com/a","https://linkedin.com/b"],"address":{"@type":"PostalAddress","streetAddress":"229 Tây Sơn"}},{"@type":"FAQPage"}]}</script>
<script>var hidden="không tính chữ này";</script></head><body><h1>Giải pháp truyền thông</h1><p>${'nội dung thật '.repeat(100)}</p>
<p>Địa chỉ: Tầng 3, 229 Tây Sơn. Mã số thuế 0109. Hotline 0912 345 678. Email: hi@ex.com. Công ty Cổ phần Công nghệ & Truyền thông Không Gian Số. © 2024–2026</p>
<a href="tel:0912345678">Gọi</a><a href="mailto:hi@ex.com">Email</a><a href="https://www.facebook.com/a">FB</a><a href="https://zalo.me/1">Zalo</a><a href="/gioi-thieu/">Giới thiệu</a>
<form></form><p>Nhận tư vấn miễn phí. Đặt lịch hẹn ngay.</p></body></html>`;
const h = analyzeHtml(html, 'https://ex.com/', { legal: 'Công ty Cổ phần Công nghệ & Truyền thông Không Gian Số' });
assert.ok(h.words > 200 && !h.shell); assert.equal(h.lang, 'vi'); assert.equal(h.h1[0], 'Giải pháp truyền thông');
assert.deepEqual(h.schemaTypes.sort(), ['FAQPage', 'Organization', 'PostalAddress'].sort());
assert.deepEqual(h.org.fields, ['name', 'url', 'logo', 'sameAs', 'address']); assert.equal(h.org.sameAs, 2);
assert.deepEqual(h.social.sort(), ['facebook.com', 'zalo.me']); assert.equal(h.tel, 1); assert.equal(h.mailto, 1); assert.equal(h.forms, 1);
assert.ok(h.phones >= 1 && h.emails >= 1 && h.addressHint && h.taxHint && h.legalNameFound && h.booking);
assert.equal(h.price.contactOnly, true); assert.equal(h.dates.copyrightYear, 2026); assert.equal(h.aboutUrl, 'https://ex.com/gioi-thieu/');
assert.ok(!html.includes('không tính chữ này') || !JSON.stringify(h).includes('không tính chữ này'));
const shell = analyzeHtml('<html><body><div id="root"></div><script src="/app.js"></script></body></html>', 'https://ex.com/');
assert.equal(shell.shell, true);
assert.deepEqual(parseSitemap('<urlset><url><loc>https://a/1</loc><lastmod>2026-09-01</lastmod></url><url><loc>https://a/2</loc><lastmod>2026-10-05T10:00:00Z</lastmod></url></urlset>'), { index: false, urls: 2, children: [], latest: '2026-10-05' });

/* ---------- API: /api/scan, /api/entity, /api/verify-claim ---------- */
const site = http.createServer((req, res) => {
  const ua = req.headers['user-agent'] || '';
  if (/GPTBot/.test(ua)) { res.writeHead(403); return res.end('blocked'); }
  if (req.url === '/') { res.writeHead(301, { Location: '/home' }); return res.end(); }
  if (req.url === '/home') { res.writeHead(200, { 'Content-Type': 'text/html', 'Last-Modified': 'Tue, 10 Nov 2026 08:00:00 GMT' }); return res.end(html); }
  if (req.url === '/gioi-thieu/') { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end('<html><body><p>Về chúng tôi</p><script type="application/ld+json">{"@type":"Service","name":"MCN"}</script></body></html>'); }
  if (req.url === '/robots.txt') { res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end(`User-agent: GPTBot\nDisallow: /\nUser-agent: *\nAllow: /\nSitemap: http://127.0.0.1:${site.address().port}/sm.xml`); }
  if (req.url === '/sm.xml') { res.writeHead(200, { 'Content-Type': 'application/xml' }); return res.end('<urlset><url><loc>/a</loc><lastmod>2026-11-01</lastmod></url></urlset>'); }
  res.writeHead(404); res.end('<html>404</html>');
});
const wiki = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x'); res.writeHead(200, { 'Content-Type': 'application/json' });
  assert.match(req.headers['user-agent'], /NetSpace-CheckAI/, 'Wikimedia requires a descriptive User-Agent');
  if (u.searchParams.get('action') === 'wbsearchentities') return res.end(JSON.stringify({ search: [{ id: 'Q1' }, { id: 'Q2' }] }));
  return res.end(JSON.stringify({ entities: { Q1: { id: 'Q1', labels: { vi: { value: 'NetSpace' } }, descriptions: { vi: { value: 'công ty truyền thông' } }, claims: { P856: [{ mainsnak: { datavalue: { value: 'https://www.netspace.vn/' } } }] }, sitelinks: {} },
    Q2: { id: 'Q2', labels: { en: { value: 'Netspace' } }, descriptions: { en: { value: 'Angolan telecom' } }, claims: {}, sitelinks: { enwiki: { title: 'Netspace' } } } } }));
});
const listen = s => new Promise(r => s.listen(0, '127.0.0.1', r));
await listen(site); await listen(wiki);
const f = await startFakes();
Object.assign(process.env, { SUPABASE_URL: `http://127.0.0.1:${f.ports.supabase}`, SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test', SUPABASE_SECRET_KEY: 'sb_secret_test', ALLOWED_EMAIL_DOMAINS: 'netspace.vn',
  AI_GATEWAY_API_KEY: 'gateway-evidence-test', COOKIE_INSECURE: '1', DAILY_CALL_LIMIT: '100', SCAN_ALLOW_PRIVATE: '1', WIKIDATA_API: `http://127.0.0.1:${wiki.address().port}/w/api.php` });
const server = await startServer(0), base = `http://127.0.0.1:${server.address().port}`;
const nativeFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  if (String(url).startsWith('https://ai-gateway.vercel.sh/v1/messages')) {
    const body = JSON.parse(init.body); assert.ok(body.tools && body.tools[0].type.startsWith('web_search'), 'claim check must use web search');
    const answer = JSON.stringify({ sources: [
      { url: 'https://kol.gov.vn/gioi-thieu', ten_nguon: 'kol.gov.vn', loai: 'co_quan_nha_nuoc', doc_lap: true, xac_nhan: true },
      { url: 'https://vtv.vn/bai-viet', ten_nguon: 'VTV', loai: 'bao_chi_tu_viet', doc_lap: true, xac_nhan: true },
      { url: 'https://bia-dat.vn/khong-co-that', ten_nguon: 'Bịa', loai: 'bao_chi_tu_viet', doc_lap: true, xac_nhan: true },
      { url: 'https://netspace.vn/about', ten_nguon: 'NetSpace', loai: 'bao_chi_tu_viet', doc_lap: true, xac_nhan: true } ], mau_thuan: '', ghi_chu: 'ok' });
    return Response.json({ stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 }, content: [
      { type: 'server_tool_use', id: 's1', name: 'web_search', input: { query: 'NetSpace kol.gov.vn' } },
      { type: 'web_search_tool_result', tool_use_id: 's1', content: [{ type: 'web_search_result', url: 'https://kol.gov.vn/gioi-thieu/', title: 'KOL' }, { type: 'web_search_result', url: 'https://www.vtv.vn/bai-viet', title: 'VTV' }, { type: 'web_search_result', url: 'https://netspace.vn/about', title: 'NS' }] },
      { type: 'text', text: answer }] });
  }
  return nativeFetch(url, init);
};
try {
  const login = await fetch(base + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json', 'X-ABR': '1' }, body: JSON.stringify({ email: 'staff@netspace.vn', password: USERS['staff@netspace.vn'] }) });
  const cookie = login.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
  const post = async (path, body, withCookie = true) => { const r = await fetch(base + path, { method: 'POST', headers: { ...(withCookie ? { Cookie: cookie } : {}), 'X-ABR': '1', 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); return { status: r.status, data: await r.json() }; };
  for (const p of ['/api/scan', '/api/entity', '/api/verify-claim']) assert.equal((await post(p, {}, false)).status, 401, p + ' requires login');

  const scan = await post('/api/scan', { url: `http://127.0.0.1:${site.address().port}/`, legal: 'Công ty Cổ phần Công nghệ & Truyền thông Không Gian Số' });
  assert.equal(scan.status, 200, JSON.stringify(scan.data)); const s = scan.data;
  assert.match(s.finalUrl, /\/home$/, 'follows redirects'); assert.equal(s.home.status, 200); assert.equal(s.home.dates.lastModified, 'Tue, 10 Nov 2026 08:00:00 GMT');
  assert.equal(s.robots.bots.GPTBot.allowed, false); assert.equal(s.robots.bots.PerplexityBot.allowed, true); assert.equal(s.robots.bots.GPTBot.kind, 'training');
  assert.equal(s.wafTest.bots.GPTBot, 403); assert.equal(s.wafTest.bots.ClaudeBot, 200);
  assert.equal(s.sitemap.found, true); assert.equal(s.sitemap.latest, '2026-11-01'); assert.equal(s.llms.found, false);
  assert.equal(s.about.status, 200); assert.ok(s.about.schemaTypes.includes('Service'));
  assert.equal((await post('/api/scan', { url: 'ftp://x' })).status, 400);

  const ent = await post('/api/entity', { name: 'NetSpace', website: 'https://netspace.vn' });
  assert.equal(ent.status, 200, JSON.stringify(ent.data)); assert.equal(ent.data.matchedId, 'Q1'); assert.equal(ent.data.entities.filter(e => !e.matched).length, 1);

  const cl = await post('/api/verify-claim', { claim: 'Đối tác công nghệ của kol.gov.vn', brand: 'NetSpace', website: 'https://netspace.vn' });
  assert.equal(cl.status, 200, JSON.stringify(cl.data));
  assert.equal(cl.data.droppedUnverified, 1, 'URL not in real search results is dropped');
  assert.equal(cl.data.independent, 2); assert.equal(cl.data.status, 'Đã kiểm chứng');
  const own = cl.data.sources.find(x => x.url.includes('netspace.vn')); assert.equal(own.independent, false, "brand's own site is never independent");
  assert.equal((await post('/api/verify-claim', { claim: 'abc' })).status, 400);
  console.log('Evidence API: SSRF guard, robots RFC 9309, HTML/sitemap analysis, scan, Wikidata entity and claim verification passed.');
} finally { globalThis.fetch = nativeFetch; server.close(); f.close(); site.close(); wiki.close(); }
