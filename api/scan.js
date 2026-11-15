import { route, ok, allowMethods, readJson } from './_lib/util.js';
import { requireUser } from './_lib/auth.js';
import { bump } from './_lib/usage.js';
import { safeFetch, normalizeTarget, UA } from './_lib/safe-fetch.js';
import { AI_BOTS, parseRobots, robotsAllows, analyzeHtml, parseSitemap } from './_lib/scan.js';

const BOT_UA = { GPTBot: 'Mozilla/5.0 (compatible; GPTBot/1.2; +https://openai.com/gptbot)', 'OAI-SearchBot': 'Mozilla/5.0 (compatible; OAI-SearchBot/1.0; +https://openai.com/searchbot)',
  ClaudeBot: 'Mozilla/5.0 (compatible; ClaudeBot/1.0; +claudebot@anthropic.com)', PerplexityBot: 'Mozilla/5.0 (compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)' };
const BROWSER = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const page = r => (r && r.status === 200 && /<html|<body|<head/i.test(r.text || ''));

/** Quét kỹ thuật website: robots.txt cho từng bot AI, phản hồi theo user-agent, sitemap, llms.txt, trang chủ và trang giới thiệu. */
export default route(async (req, res) => {
  allowMethods(req, ['POST']);
  const user = await requireUser(req, res);
  const b = await readJson(req, 10_000);
  const target = normalizeTarget(b.url);
  const legal = String(b.legal || '').slice(0, 200);
  await bump(user.email, 1);
  const at = new Date().toISOString();

  const home = await safeFetch(target.href);
  const finalUrl = home.url, origin = new URL(finalUrl).origin;
  const homeA = page(home) ? analyzeHtml(home.text, finalUrl, { legal }) : null;
  const lastModified = h => (h && h.headers && h.headers.get('last-modified')) || null;

  const [robotsR, llmsR, aboutR, ...wafR] = await Promise.all([
    safeFetch(origin + '/robots.txt', { accept: 'text/plain,*/*', maxBytes: 500_000 }),
    safeFetch(origin + '/llms.txt', { accept: 'text/plain,*/*', maxBytes: 200_000 }),
    homeA && homeA.aboutUrl ? safeFetch(homeA.aboutUrl) : Promise.resolve(null),
    safeFetch(finalUrl, { userAgent: BROWSER, maxBytes: 64_000 }),
    ...Object.values(BOT_UA).map(ua => safeFetch(finalUrl, { userAgent: ua, maxBytes: 64_000 })),
  ]);

  const robotsFound = robotsR.status === 200 && !/<html/i.test(robotsR.text || '');
  const parsed = robotsFound ? parseRobots(robotsR.text) : { groups: [], sitemaps: [] };
  const bots = Object.fromEntries(AI_BOTS.map(bt => [bt.name, { ...robotsAllows(parsed, bt.name, new URL(finalUrl).pathname || '/'), kind: bt.kind, owner: bt.owner }]));

  let sitemap = { found: false, urls: 0, latest: null, url: null };
  for (const sm of [...parsed.sitemaps.slice(0, 2), origin + '/sitemap.xml', origin + '/sitemap_index.xml']) {
    let r; try { r = await safeFetch(sm, { accept: 'application/xml,text/xml,*/*', maxBytes: 3_000_000 }); } catch { continue; }
    if (r.status !== 200 || !/<(urlset|sitemapindex)\b/i.test(r.text || '')) continue;
    const p = parseSitemap(r.text);
    if (p.index && p.children[0]) {
      let urls = 0, latest = p.latest;
      for (const child of p.children.slice(0, 3)) {
        try { const c = await safeFetch(child, { accept: 'application/xml,text/xml,*/*', maxBytes: 3_000_000 }); if (c.status === 200) { const q = parseSitemap(c.text); urls += q.urls; if (q.latest && (!latest || q.latest > latest)) latest = q.latest; } } catch { /* bỏ qua */ }
      }
      sitemap = { found: true, url: r.url, urls, latest, index: true, children: p.children.length };
    } else sitemap = { found: true, url: r.url, urls: p.urls, latest: p.latest };
    break;
  }
  const aboutA = page(aboutR) ? analyzeHtml(aboutR.text, aboutR.url, { legal }) : null;
  const pack = (r, a) => a ? { url: r.url, status: r.status, ms: r.ms, bytes: r.bytes, xRobots: (r.headers && r.headers.get('x-robots-tag')) || '', ...a, dates: { ...a.dates, lastModified: lastModified(r) } } : (r ? { url: r.url, status: r.status, error: r.error || null } : null);

  ok(res, {
    at, url: target.href, finalUrl, origin, https: finalUrl.startsWith('https://'), userAgent: UA,
    home: pack(home, homeA), about: aboutR ? pack(aboutR, aboutA) : null,
    robots: { found: robotsFound, status: robotsR.status, sitemaps: parsed.sitemaps.slice(0, 10), bots },
    wafTest: { base: wafR[0].status, bots: Object.fromEntries(Object.keys(BOT_UA).map((k, i) => [k, wafR[i + 1].status])) },
    sitemap, llms: { found: llmsR.status === 200 && !/<html/i.test(llmsR.text || '') && (llmsR.text || '').trim().length > 20, status: llmsR.status },
  });
});
