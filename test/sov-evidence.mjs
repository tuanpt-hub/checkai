import assert from 'node:assert/strict';
await import('../public/sov.js'); await import('../public/evidence.js');
const S = globalThis.CheckAISov, E = globalThis.CheckAIEvidence;
// Khớp tên: dấu, hoa thường, biến thể
assert.ok(S.matches('Công ty NetSpace', { name: 'NetSpace' }));
assert.ok(S.matches('netspace.vn', { name: 'NetSpace' }));
assert.ok(S.matches('Không Gian Số', { name: 'NetSpace', aliases: 'Không gian số' }));
assert.ok(!S.matches('Netflix', { name: 'NetSpace' }));
// Wilson: 8/20 ≈ 40% (21.9%–61.3%)
const w = S.wilson(8, 20); assert.ok(Math.abs(w.lo - 0.219) < 0.005 && Math.abs(w.hi - 0.613) < 0.005, JSON.stringify(w));
assert.equal(S.wilson(0, 0), null);
// Kappa: khớp hoàn toàn = 1, không khớp hơn ngẫu nhiên ≈ 0
assert.equal(S.kappa([[1, 1], [2, 2], [0, 0]]).kappa, 1);
assert.equal(S.kappa([]).n, 0);
const kk = S.kappa([[0, 0], [0, 1], [1, 0], [1, 1]]); assert.equal(kk.agree, .5); assert.ok(Math.abs(kk.kappa) < 1e-9);
// Share of voice
const records = [
  { engine: 'Claude', g: 'S', code: 3, brands: [{ name: 'NetSpace', rank: 1, sentiment: 'tich_cuc' }, { name: 'Dinos', rank: 2 }] },
  { engine: 'Claude', g: 'S', code: 0, brands: [{ name: 'Dinos', rank: 1 }, { name: 'UpBase', rank: 2 }], sources: [{ url: 'https://vnexpress.net/a' }] },
  { engine: 'Gemini', g: 'C', code: 2, human: 0, brands: [{ name: 'Dinos', rank: 1, sentiment: 'tieu_cuc' }], sources: [{ url: 'https://vertexaisearch.cloud.google.com/x', title: 'brandsvietnam.com' }] },
  { engine: 'Gemini', g: 'B', code: 3, brands: [{ name: 'NetSpace' }] },          // nhóm B không tính SOV
  { engine: 'ChatGPT', g: 'S', code: 2 },                                           // dữ liệu cũ không có brands: bỏ qua
];
const comps = [{ name: 'Dinos', status: 'approved' }, { name: 'UpBase', status: 'rejected' }];
const sov = S.shareOfVoice({ records, brand: { name: 'NetSpace' }, competitors: comps });
const all = sov['Tất cả']; assert.equal(all.answers, 3);
const b = all.rows.find(r => r.isBrand), d = all.rows.find(r => r.name === 'Dinos');
assert.equal(b.mentions, 1, 'human override 0 removes the Gemini mention'); assert.equal(d.mentions, 3);
assert.equal(b.sov, .25); assert.equal(d.sov, .75); assert.equal(b.top3Rate, 1 / 3); assert.equal(d.avgRank, (2 + 1 + 1) / 3); assert.equal(d.neg, 1);
assert.equal(all.rows.length, 2, 'rejected competitors are not tracked');
// Gợi ý đối thủ: bỏ thương hiệu và đối thủ đã có (kể cả đã bỏ qua)
const sug = S.suggestCompetitors({ records, brand: { name: 'NetSpace' }, competitors: [{ name: 'Dinos', status: 'approved' }] });
assert.deepEqual(sug.map(x => x.name), ['UpBase']);
// Nguồn trích dẫn: tên miền thật từ liên kết chuyển hướng của Gemini; khoảng trống
const dom = S.citationDomains({ records, brand: { name: 'NetSpace' }, competitors: comps, brandDomains: ['netspace.vn'] });
assert.deepEqual(dom.map(x => x.domain).sort(), ['brandsvietnam.com', 'vnexpress.net']);
assert.equal(dom.find(x => x.domain === 'vnexpress.net').gap, 1);
assert.equal(dom.find(x => x.domain === 'brandsvietnam.com').gap, 1, 'human override 0 => brand not mentioned');
// Điểm từ dữ liệu quét
const page = { status: 200, words: 900, robotsMeta: '', schemaTypes: ['Organization', 'WebSite'], org: { fields: ['name', 'url', 'logo'], sameAs: 0 }, social: ['facebook.com', 'linkedin.com'], tel: 1, mailto: 1, forms: 0, phones: 1, emails: 1, addressHint: true, taxHint: false, legalNameFound: false, price: { contactOnly: true }, booking: false, dates: { copyrightYear: 2026 } };
const scan = { at: '2026-11-15T00:00:00Z', https: true, home: page, about: null, sitemap: { found: true, urls: 40, latest: '2026-10-01' },
  robots: { found: true, bots: { 'OAI-SearchBot': { allowed: true, kind: 'search' }, PerplexityBot: { allowed: false, kind: 'search' }, GPTBot: { allowed: false, kind: 'training' } } },
  wafTest: { base: 200, bots: { GPTBot: 200, ClaudeBot: 200 } } };
const sc = E.fromScan(scan);
assert.equal(sc['1.1'][0], 2, 'half of search bots allowed'); assert.match(sc['1.1'][1], /PerplexityBot/);
assert.equal(sc['1.2'][0], 4); assert.equal(sc['1.5'][0], 4); assert.equal(sc['2.2'][0], 2); assert.equal(sc['2.4'][0], 3);
assert.equal(sc['2.6'][0], 2); assert.equal(sc['3.3'][0], 1); assert.equal(sc['6.4'][0], 1); assert.equal(sc['6.6'][0], 2);
assert.equal(E.fromScan({ ...scan, wafTest: { base: 200, bots: { GPTBot: 403 } } })['1.1'][0], 1, 'WAF block');
assert.equal(E.fromScan({ ...scan, home: { ...page, words: 40 }, sitemap: { found: false } })['1.2'][0], 1, 'JS shell + no sitemap');
assert.equal(E.fromScan({ ...scan, home: { ...page, robotsMeta: 'noindex' } })['1.2'][0], 0);
// Thực thể & claim
assert.equal(E.fromEntity({ entities: [{ id: 'Q1', matched: true }, { id: 'Q2' }] })['2.5'][0], 3);
assert.equal(E.fromEntity({ entities: [{ id: 'Q2' }] })['2.5'][0], 1);
assert.equal(E.fromClaims({ a: { independent: 2 }, b: { independent: 0 } }, ['a', 'b', 'c'])['4.1'][0], 2);
assert.deepEqual(E.fromClaims({}, ['a']), {});
console.log('SOV, CI, kappa, competitor suggestions, citation domains and evidence scoring passed.');
