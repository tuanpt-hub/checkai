/** Phân tích robots.txt, HTML và sitemap (không dùng thư viện DOM). */
export const AI_BOTS = [
  { name: 'OAI-SearchBot', kind: 'search', owner: 'OpenAI' }, { name: 'ChatGPT-User', kind: 'search', owner: 'OpenAI' }, { name: 'GPTBot', kind: 'training', owner: 'OpenAI' },
  { name: 'Claude-SearchBot', kind: 'search', owner: 'Anthropic' }, { name: 'Claude-User', kind: 'search', owner: 'Anthropic' }, { name: 'ClaudeBot', kind: 'training', owner: 'Anthropic' },
  { name: 'PerplexityBot', kind: 'search', owner: 'Perplexity' }, { name: 'Perplexity-User', kind: 'search', owner: 'Perplexity' },
  { name: 'Googlebot', kind: 'search', owner: 'Google' }, { name: 'Google-Extended', kind: 'training', owner: 'Google' },
  { name: 'Bingbot', kind: 'search', owner: 'Microsoft' }, { name: 'CCBot', kind: 'training', owner: 'Common Crawl' }, { name: 'Applebot-Extended', kind: 'training', owner: 'Apple' },
];

export function parseRobots(text) {
  const groups = [], sitemaps = [];
  let cur = null, lastAgent = false;
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim();
    const i = line.indexOf(':');
    if (!line || i < 0) continue;
    const k = line.slice(0, i).trim().toLowerCase(), v = line.slice(i + 1).trim();
    if (k === 'user-agent') { if (!cur || !lastAgent) { cur = { agents: [], rules: [] }; groups.push(cur); } cur.agents.push(v.toLowerCase()); lastAgent = true; continue; }
    lastAgent = false;
    if ((k === 'allow' || k === 'disallow') && cur) cur.rules.push({ allow: k === 'allow', path: v });
    else if (k === 'sitemap' && v) sitemaps.push(v);
  }
  return { groups, sitemaps };
}
function ruleRe(pattern) {
  const anchored = pattern.endsWith('$'), p = anchored ? pattern.slice(0, -1) : pattern;
  return new RegExp('^' + p.split('*').map(s => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + (anchored ? '$' : ''));
}
/** RFC 9309: nhóm theo tên bot, nếu không có thì nhóm '*'; luật dài nhất thắng, bằng nhau thì Allow thắng. */
export function robotsAllows(parsed, agent, path = '/') {
  const a = agent.toLowerCase();
  let groups = parsed.groups.filter(g => g.agents.includes(a)), matched = 'agent';
  if (!groups.length) { groups = parsed.groups.filter(g => g.agents.includes('*')); matched = groups.length ? '*' : null; }
  let best = null;
  for (const g of groups) for (const r of g.rules) {
    if (!r.path) continue;
    if (ruleRe(r.path).test(path) && (!best || r.path.length > best.path.length || (r.path.length === best.path.length && r.allow && !best.allow))) best = r;
  }
  return { allowed: best ? best.allow : true, matched, rule: best ? (best.allow ? 'Allow: ' : 'Disallow: ') + best.path : null };
}

const attrs = tag => Object.fromEntries([...tag.matchAll(/([\w:-]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/g)].map(m => [m[1].toLowerCase(), m[3] ?? m[4] ?? m[5] ?? '']));
const decode = s => String(s || '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&copy;/g, '©');
const strip = s => decode(String(s || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/[^a-z0-9]+/g, ' ').trim();
const ORG_TYPES = ['Organization', 'Corporation', 'LocalBusiness', 'NewsMediaOrganization', 'ProfessionalService', 'OnlineBusiness', 'EducationalOrganization', 'GovernmentOrganization'];
const ORG_FIELDS = [['name'], ['url'], ['logo'], ['sameAs'], ['legalName'], ['address'], ['taxID', 'vatID'], ['founder', 'employee', 'member'], ['contactPoint', 'telephone', 'email'], ['description']];
const SOCIAL = ['facebook.com', 'linkedin.com', 'youtube.com', 'tiktok.com', 'x.com', 'twitter.com', 'instagram.com', 'zalo.me'];

function flattenLd(node, out) {
  if (Array.isArray(node)) { node.forEach(n => flattenLd(n, out)); return; }
  if (!node || typeof node !== 'object') return;
  if (node['@type']) out.push(node);
  if (node['@graph']) flattenLd(node['@graph'], out);
  for (const v of Object.values(node)) if (v && typeof v === 'object' && v !== node['@graph']) flattenLd(v, out);
}

export function analyzeHtml(html, pageUrl, { legal } = {}) {
  const src = String(html || ''), base = new URL(pageUrl);
  const body = src.replace(/<!--[\s\S]*?-->/g, ' ').replace(/<(script|style|noscript|svg|template)\b[\s\S]*?<\/\1>/gi, ' ');
  const text = strip(body), words = text ? text.split(' ').length : 0;
  const metas = [...src.matchAll(/<meta\b[^>]*>/gi)].map(m => attrs(m[0]));
  const meta = n => (metas.find(m => (m.name || m.property || '').toLowerCase() === n) || {}).content || '';
  const links = [...src.matchAll(/<link\b[^>]*>/gi)].map(m => attrs(m[0]));
  const anchors = [...src.matchAll(/<a\b[^>]*href\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>([\s\S]*?)<\/a>/gi)].map(m => ({ href: decode(m[2] ?? m[3] ?? m[4] ?? ''), text: strip(m[5]) }));
  const ld = [], ldErrors = [];
  for (const m of src.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { flattenLd(JSON.parse(m[1].trim()), ld); } catch { ldErrors.push('JSON-LD không hợp lệ'); }
  }
  const types = [...new Set(ld.flatMap(n => [].concat(n['@type'])).map(String))];
  const orgNode = ld.filter(n => [].concat(n['@type']).some(t => ORG_TYPES.includes(t)))
    .sort((a, b) => Object.keys(b).length - Object.keys(a).length)[0];
  const org = orgNode ? { fields: ORG_FIELDS.filter(alts => alts.some(f => orgNode[f] != null && orgNode[f] !== '')).map(alts => alts[0]),
    sameAs: [].concat(orgNode.sameAs || []).filter(Boolean).length, name: String(orgNode.name || '').slice(0, 120) } : null;
  const hrefs = anchors.map(a => a.href);
  const hostOf = h => { try { return new URL(h, base).hostname.toLowerCase().replace(/^www\./, ''); } catch { return ''; } };
  const social = [...new Set(hrefs.map(hostOf).map(h => SOCIAL.find(s => h === s || h.endsWith('.' + s))).filter(Boolean))];
  const aboutLink = anchors.map(a => { try { return { u: new URL(a.href, base), t: a.text }; } catch { return null; } })
    .find(x => x && x.u.hostname === base.hostname && /^https?:$/.test(x.u.protocol) && x.u.pathname !== base.pathname && (/(gioi-thieu|ve-chung-toi|about)/i.test(x.u.pathname) || /^(giới thiệu|về chúng tôi|about( us)?)$/i.test(x.t)));
  const dateModified = ld.map(n => n.dateModified).filter(Boolean).sort().pop() || meta('article:modified_time') || meta('og:updated_time') || null;
  const years = [...text.matchAll(/(?:©|copyright)\s*(?:\d{4}\s*[-–]\s*)?(\d{4})/gi)].map(m => Number(m[1])).filter(y => y > 1990 && y < 2100);
  const currency = (text.match(/\d[\d.,]*\s?(?:₫|đ\b|vnđ|vnd|usd|\$)|(?:₫|\$)\s?\d[\d.,]*/gi) || []).length;
  return {
    words, shell: words < 150 && /<div[^>]+id=["'](root|app|__next|__nuxt)["']/i.test(src),
    title: strip((src.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1]).slice(0, 200), description: meta('description').slice(0, 300),
    robotsMeta: meta('robots'), canonical: (links.find(l => (l.rel || '').toLowerCase() === 'canonical') || {}).href || '',
    lang: (src.match(/<html[^>]*\blang=["']?([\w-]+)/i) || [])[1] || '',
    h1: [...src.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)].map(m => strip(m[1]).slice(0, 160)).slice(0, 3),
    schemaTypes: types.slice(0, 30), ldErrors: ldErrors.length, org, social,
    tel: hrefs.filter(h => /^tel:/i.test(h)).length, mailto: hrefs.filter(h => /^mailto:/i.test(h)).length, forms: (src.match(/<form\b/gi) || []).length,
    phones: (text.match(/(?:\+84|\b0)[\s.-]?\d{2,3}[\s.-]?\d{3}[\s.-]?\d{3,4}\b/g) || []).length,
    emails: (text.match(/[\w.+-]+@[\w-]+\.[\w.-]+/g) || []).length,
    addressHint: /(địa chỉ|trụ sở|address|tầng \d|phường|quận|street)/i.test(text), taxHint: /(mã số thuế|\bmst\b|tax id|đăng ký doanh nghiệp|vat)/i.test(text),
    legalNameFound: !!(legal && norm(legal).length > 5 && norm(text).includes(norm(legal))),
    price: { currency, offerSchema: types.some(t => ['Offer', 'AggregateOffer', 'PriceSpecification'].includes(t)),
      priceWords: /(bảng giá|báo giá|giá từ|pricing|price list)/i.test(text), contactOnly: currency === 0 && /(liên hệ|nhận tư vấn|contact us|get a quote)/i.test(text) },
    booking: /(đặt lịch|đặt hẹn|book (a|now)|booking|đăng ký tư vấn|yêu cầu báo giá|request a (quote|demo))/i.test(text),
    dates: { dateModified, copyrightYear: years.length ? Math.max(...years) : null },
    aboutUrl: aboutLink ? aboutLink.u.href : null,
  };
}

export function parseSitemap(xml) {
  const s = String(xml || '');
  const index = /<sitemapindex\b/i.test(s), locs = [...s.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map(m => m[1]);
  const lastmods = [...s.matchAll(/<lastmod>\s*([^<\s]+)\s*<\/lastmod>/gi)].map(m => m[1]).filter(d => Number.isFinite(Date.parse(d)));
  return { index, urls: index ? 0 : locs.length, children: index ? locs.slice(0, 20) : [], latest: lastmods.sort((a, b) => Date.parse(a) - Date.parse(b)).pop()?.slice(0, 10) || null };
}
