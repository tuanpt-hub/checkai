/* Share of voice, khoảng tin cậy, độ khớp giám khảo và nguồn trích dẫn. Dùng chung trình duyệt/Node. */
(function(root) {
  const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd').replace(/[^a-z0-9]+/g, ' ').trim();
  const aliasList = s => String(s || '').split(/[;,\n]/).map(x => x.trim()).filter(Boolean);
  const keysOf = e => [e.name, ...aliasList(e.aliases)].map(norm).filter(x => x.length >= 2);
  function matches(name, entity) {
    const n = norm(name);
    if (!n) return false;
    return keysOf(entity).some(k => n === k
      || (k.length >= 4 && (' ' + n + ' ').includes(' ' + k + ' '))
      || (n.length >= 4 && (' ' + k + ' ').includes(' ' + n + ' ')));
  }
  /** Mã hiệu lực: chuyên viên chấm lại thì lấy điểm của chuyên viên. */
  const eff = r => (r && r.human != null ? r.human : r && r.code);
  /** Khoảng tin cậy Wilson 95% cho tỷ lệ k/n. */
  function wilson(k, n, z = 1.96) {
    if (!n) return null;
    const p = k / n, d = 1 + z * z / n, c = p + z * z / (2 * n);
    const m = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n));
    return { p, lo: Math.max(0, (c - m) / d), hi: Math.min(1, (c + m) / d) };
  }
  /** Độ khớp giữa AI chấm và chuyên viên chấm (thang 0–3): tỷ lệ trùng và Cohen's kappa. */
  function kappa(pairs, cats = [0, 1, 2, 3]) {
    const n = pairs.length;
    if (!n) return { n: 0, agree: null, kappa: null };
    const po = pairs.filter(([x, y]) => x === y).length / n;
    let pe = 0;
    for (const c of cats) pe += (pairs.filter(p => p[0] === c).length / n) * (pairs.filter(p => p[1] === c).length / n);
    return { n, agree: po, kappa: pe >= 1 ? null : (po - pe) / (1 - pe) };
  }
  const brandEntity = b => ({ key: '__brand', name: b.name, aliases: b.aliases, isBrand: true });
  /** records: [{engine, g, code, human, brands:[{name,rank,sentiment}]}] – chỉ tính bản ghi có danh sách brands. */
  function shareOfVoice({ records, brand, competitors = [], groups = ['C', 'S'] }) {
    const ents = [brandEntity(brand), ...competitors.filter(c => c.status === 'approved').map(c => ({ key: norm(c.name), name: c.name, aliases: c.aliases }))];
    const out = {};
    const bucket = k => (out[k] = out[k] || { answers: 0, stats: Object.fromEntries(ents.map(e => [e.key, { mentions: 0, top3: 0, rankSum: 0, rankN: 0, pos: 0, neu: 0, neg: 0 }])) });
    for (const r of records) {
      if (!groups.includes(r.g) || !Array.isArray(r.brands)) continue;
      for (const k of ['Tất cả', r.engine]) {
        const b = bucket(k); b.answers++;
        for (const e of ents) {
          const hits = r.brands.filter(x => x && matches(x.name, e));
          const on = e.isBrand ? (eff(r) >= 1 || hits.length > 0) : hits.length > 0;
          if (!on) continue;
          const st = b.stats[e.key]; st.mentions++;
          const ranks = hits.map(h => Number(h.rank)).filter(x => Number.isFinite(x) && x > 0);
          if (ranks.length) { const rk = Math.min(...ranks); st.rankSum += rk; st.rankN++; if (rk <= 3) st.top3++; }
          else if (e.isBrand && eff(r) >= 3) st.top3++;
          const s = (hits[0] && hits[0].sentiment) || 'trung_tinh';
          if (s === 'tich_cuc') st.pos++; else if (s === 'tieu_cuc') st.neg++; else st.neu++;
        }
      }
    }
    for (const k in out) {
      const b = out[k], total = Object.values(b.stats).reduce((x, s) => x + s.mentions, 0);
      b.rows = ents.map(e => {
        const s = b.stats[e.key];
        return { name: e.name, isBrand: !!e.isBrand, mentions: s.mentions, sov: total ? s.mentions / total : null,
          mentionRate: b.answers ? s.mentions / b.answers : null, ci: wilson(s.mentions, b.answers),
          top3Rate: b.answers ? s.top3 / b.answers : null, avgRank: s.rankN ? s.rankSum / s.rankN : null,
          pos: s.pos, neu: s.neu, neg: s.neg };
      });
      delete b.stats;
    }
    return out;
  }
  /** Thương hiệu khác được AI nêu nhiều nhất, chưa có trong danh sách đối thủ (kể cả đã bỏ qua). */
  function suggestCompetitors({ records, brand, competitors = [], limit = 12 }) {
    const be = brandEntity(brand), seen = new Map();
    for (const r of records) for (const x of (Array.isArray(r.brands) ? r.brands : [])) {
      const name = String(x && x.name || '').trim();
      if (!name || norm(name).length < 2 || matches(name, be) || competitors.some(c => matches(name, c))) continue;
      const k = norm(name), cur = seen.get(k) || { name, count: 0, engines: new Set(), names: {} };
      cur.count++; cur.engines.add(r.engine); cur.names[name] = (cur.names[name] || 0) + 1; seen.set(k, cur);
    }
    return [...seen.values()].map(v => ({ name: Object.entries(v.names).sort((a, b) => b[1] - a[1])[0][0], count: v.count, engines: [...v.engines] }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)).slice(0, limit);
  }
  function domainOf(src) {
    let host = '';
    try { host = new URL(src.url).hostname.toLowerCase().replace(/^www\./, ''); } catch { return ''; }
    // Gemini trả liên kết chuyển hướng; tiêu đề thường là tên miền thật.
    if (/vertexaisearch|googleusercontent/.test(host) && /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(String(src.title || '').trim())) host = String(src.title).trim().toLowerCase().replace(/^www\./, '');
    return host;
  }
  /** Tên miền AI hay trích dẫn; "khoảng trống" = câu có đối thủ được nhắc nhưng thiếu thương hiệu. */
  function citationDomains({ records, brand, competitors = [], brandDomains = [], limit = 15 }) {
    const comps = competitors.filter(c => c.status === 'approved'), map = new Map();
    const owned = d => brandDomains.some(b => b && (d === b || d.endsWith('.' + b)));
    for (const r of records) {
      const doms = [...new Set((r.sources || []).map(domainOf).filter(Boolean))];
      if (!doms.length) continue;
      const brandOn = eff(r) >= 1, compOn = Array.isArray(r.brands) && r.brands.some(x => comps.some(c => matches(x && x.name, c)));
      for (const d of doms) {
        const cur = map.get(d) || { domain: d, answers: 0, engines: new Set(), gap: 0, owned: owned(d) };
        cur.answers++; cur.engines.add(r.engine); if (compOn && !brandOn) cur.gap++; map.set(d, cur);
      }
    }
    return [...map.values()].map(x => ({ ...x, engines: [...x.engines] })).sort((a, b) => b.answers - a.answers || b.gap - a.gap).slice(0, limit);
  }
  root.CheckAISov = { norm, aliasList, matches, eff, wilson, kappa, shareOfVoice, suggestCompetitors, citationDomains, domainOf };
})(globalThis);
