import assert from 'node:assert/strict';
import fs from 'node:fs';
await import('../public/pillars.js');
const X = globalThis.CheckAIPillars;
// Bản đồ đã duyệt: 31 đòn bẩy + 5 kết quả = 36, mỗi tiêu chí một trụ cột
const html = fs.readFileSync(new URL('../public/app.html', import.meta.url), 'utf8');
const start = html.indexOf('[', html.indexOf('"criteria": ['));
let depth = 0, end = start; for (; end < html.length; end++) { if (html[end] === '[') depth++; else if (html[end] === ']' && --depth === 0) break; }
const model = JSON.parse(html.slice(start, end + 1));
assert.equal(model.length, 36, 'app model has 36 criteria');
assert.equal(X.ROWS.length, 31); assert.equal(X.OUTCOME_IDS.length, 5);
assert.deepEqual(X.P.map(p => X.levers(p).length), [7, 6, 8, 6, 4]);
assert.deepEqual(new Set([...X.ROWS.map(r => r[0]), ...X.OUTCOME_IDS]), new Set(model.map(c => c.id)), 'map covers exactly the 36 criteria of the app');
assert.equal(X.pillarOf('2.4'), 'Brand', 'decision 2'); assert.equal(X.pillarOf('1.4'), 'PR', 'decision 3'); assert.equal(X.pillarOf('6.2'), 'Kết quả');
// Điểm trụ cột, đủ dữ liệu (≥ 2/3), mức
const sc = { '1.1': 4, '1.2': 3, '1.3': 2, '6.6': null, '2.2': 1, '2.5': 1, '2.6': 2, '3.3': 0 };
const ps = X.pillarScores(id => (id in sc ? sc[id] : null), { Brand: { t: 70, reason: 'Doanh nghiệp nhỏ' } });
const T = ps.find(p => p.pillar === 'Technology'), Dd = ps.find(p => p.pillar === 'Data'), B = ps.find(p => p.pillar === 'Brand');
assert.equal(T.scored, 3); assert.equal(T.score, 75); assert.equal(T.enough, true); assert.equal(T.level[1], 'Kiểm chứng'); assert.equal(T.gap, 5); assert.deepEqual(T.missing, ['6.6']);
assert.equal(Dd.scored, 4); assert.equal(Dd.enough, true, '4/6 is enough'); assert.equal(Dd.score, 4 / 4 / 4 * 100 * 1, 'avg 1.0 → 25'); assert.equal(Dd.level[1], 'Rời rạc');
assert.equal(B.scored, 0); assert.equal(B.level, null); assert.equal(B.target, 70); assert.equal(B.reason, 'Doanh nghiệp nhỏ');
assert.equal(X.pillarScores(() => 3, { PR: { t: 10 } }).find(p => p.pillar === 'PR').target, 40, 'target clamped to 40–100');
assert.equal(X.pillarScores(id => (['3.2', '3.4', '4.5'].includes(id) ? 4 : null)).find(p => p.pillar === 'Content').enough, false, '3/6 is not enough');
assert.deepEqual([39.9, 40, 59.9, 60, 79.9, 80].map(v => X.levelOf(v)[0]), [1, 2, 2, 3, 3, 4]);
// Thứ tự phụ thuộc
assert.equal(X.dependency(ps).level, 'nen'); assert.match(X.dependency(ps).text, /^Data dưới 60/);
assert.equal(X.dependency(X.pillarScores(id => (X.levers('Brand').includes(id) ? 1 : 4))).level, 'brand');
assert.equal(X.dependency(X.pillarScores(() => 4)).level, 'ok'); assert.equal(X.dependency(X.pillarScores(() => null)), null);
// Chỉ số kết quả (quyết định 6: theo tỷ lệ đo được, cảnh báo khi cận dưới KTC 95% < đích)
const o = X.outcomes({ b: { k: 15, n: 18 }, acc: [3, 4, 4, 3], t: { k: 3, n: 30 }, s: { k: 0, n: 0 }, top3: { k: 7, n: 10, neg: 1 }, sov: { rank: 2, of: 4 } });
const g = id => o.find(x => x.id === id);
assert.equal(g('1.6').status, 'Đạt'); assert.equal(g('1.6').warn, true, '15/18 passes but small sample warns');
assert.equal(g('3.5').status, 'Đạt'); assert.equal(g('3.5').value, 3.5); assert.equal(g('5.6').status, 'Chưa đạt'); assert.equal(g('6.2').status, 'Chưa đo');
assert.equal(g('6.3').status, 'Chưa đạt', 'negative sentiment blocks 6.3'); assert.equal(g('SOV').status, 'Đạt');
assert.equal(X.outcomes({ sov: { rank: 1, of: 1 } }).find(x => x.id === 'SOV').status, 'Chưa đo', 'needs at least one competitor');
// Gắn trụ cột cho việc trong kế hoạch
assert.equal(X.pillarOfItem(['1.1', '6.6', '2.1']), 'Technology'); assert.equal(X.pillarOfItem(['6.2']), null); assert.equal(X.pillarOfItem(['2.1', '4.1']), 'Brand', 'tie → pillar order');
// Lọc đầu ra AI
const d = X.cleanDiagnosis('Data', { hien_trang: 'Schema thiếu', rui_ro: 'AI nhầm thực thể', thay_doi: [
  { tang: 'he_thong', tu: 'Không có schema', sang: 'Schema Organization đủ 8 thuộc tính', criteria: ['2.2', '9.9'], can_cu: 'Quét website: Organization 3/10', viec_dau_tien: 'Gắn JSON-LD', phu_trach: 'Tech' },
  { tang: 'tai_san', tu: 'x', sang: 'y', criteria: ['4.1'], can_cu: 'z' },
  { tang: 'quy_trinh', tu: 'x', sang: 'y', criteria: ['4.6'], can_cu: '' },
  { tang: 'la', tu: 'a', sang: 'Wikidata trỏ đúng website', criteria: ['2.5'], can_cu: 'Wikidata: không có thực thể' }] });
assert.equal(d.changes.length, 2); assert.equal(d.dropped, 2, 'other-pillar criteria and missing basis are dropped');
assert.deepEqual(d.changes[0].criteria, ['2.5']); assert.equal(d.changes[0].tier, 'tai_san', 'unknown tier falls back'); assert.deepEqual(d.changes[1].criteria, ['2.2']);
console.log('Pillars: approved map, scores, maturity, dependency, outcome indicators, plan tagging and AI output filtering passed.');
