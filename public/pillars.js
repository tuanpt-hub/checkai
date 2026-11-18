/* AI Trust Blueprint – 5 trụ cột chuyển đổi. Bản đồ và trạng thái đích do đội chuyên gia NetSpace duyệt ngày 18/11/2026.
   Dùng chung trình duyệt và Node (kiểm thử). Dữ liệu sinh từ pillars.json của sổ tay vận hành. */
(function(root) {
  const P = ["Brand", "Content", "PR", "Data", "Technology"];
  // [mã, trụ cột, trụ cột phụ, chỉ số đạt đích, nguồn đo, chỉnh theo ngành]
  const ROWS = [["2.1", "Brand", "Content", "Một cách viết duy nhất cho mỗi tên; biến thể khai báo là tên gọi khác", "So khớp nguồn", "Không"], ["2.3", "Brand", "Data", "Có trang hệ sinh thái; mỗi sản phẩm ghi rõ chủ sở hữu", "Chấm tay, AI chấm", "Không"], ["2.4", "Brand", "Technology", "Liên kết hai chiều giữa website và mọi kênh chính thức; kênh chính đã xác minh", "Quét website, chấm tay", "Không"], ["3.1", "Brand", "Content", "Câu mở đầu nêu sản phẩm, đối tượng, thị trường; lặp lại nhất quán trên các kênh", "Phân tích nội dung", "Không"], ["3.6", "Brand", "PR", "Điểm khác biệt nêu bằng dữ kiện và được nguồn bên ngoài nhắc lại", "Phân tích nội dung", "Không"], ["5.1", "Brand", "Content", "10 chủ đề được lãnh đạo duyệt, gắn sản phẩm và người phát ngôn", "Hồ sơ thương hiệu", "Doanh nghiệp nhỏ: 5 chủ đề"], ["6.1", "Brand", "Content", "20 tình huống mua có ràng buộc cụ thể, được sales xác nhận", "Hồ sơ thương hiệu", "Không"], ["1.5", "Content", "Data", "Mọi kênh chính cập nhật trong 6 tháng", "Quét website", "Không"], ["3.2", "Content", "Data", "Mọi sản phẩm chính có trang riêng đủ 5 mục", "Chấm tay, AI chấm", "Không"], ["3.4", "Content", "", "Trên 80% câu hỏi khách hay hỏi có câu trả lời trực tiếp", "Chấm tay, AI chấm", "Không"], ["4.5", "Content", "PR", "Từ 5 case study đủ tên khách, vấn đề, giải pháp, kết quả đo được", "Chấm tay, AI chấm", "B2C bán lẻ: thay bằng đánh giá có hình ảnh"], ["5.2", "Content", "PR", "Mỗi chủ đề có trang trụ cột và từ 5 bài chuyên sâu, có dữ liệu gốc", "Chấm tay, AI chấm", "Doanh nghiệp nhỏ: 3 chủ đề ưu tiên"], ["6.5", "Content", "PR", "Có trang so sánh trung thực và trang \"phù hợp với ai\"", "Chấm tay, AI chấm", "Không"], ["1.4", "PR", "Data", "Có hồ sơ đầy đủ ở ít nhất 8/10 nhóm nguồn phù hợp", "Wikidata, chấm tay", "Không"], ["4.1", "PR", "Brand", "Từ 80% claim quan trọng có 2 nguồn độc lập xác nhận", "Kiểm chứng claim", "Không"], ["4.2", "PR", "", "Từ 10 bài báo tự viết trong 24 tháng, có trích dẫn lãnh đạo", "Chấm tay", "Doanh nghiệp nhỏ: 4 bài"], ["4.3", "PR", "Content", "Trên 50 đánh giá gần đây, điểm từ 4,3, có phản hồi", "Chấm tay", "B2B: 5 lời chứng thực có tên, chức danh, công ty"], ["4.4", "PR", "", "Mọi ghi nhận chính có trang xác nhận của bên cấp", "Kiểm chứng claim, chấm tay", "Không"], ["5.3", "PR", "Content", "Mỗi chủ đề có ít nhất một chuyên gia có hồ sơ và được nhắc tên", "Chấm tay", "Không"], ["5.4", "PR", "", "Được trích dẫn chuyên môn ở từ 5 chủ đề", "Chấm tay", "Doanh nghiệp nhỏ: 3 chủ đề"], ["5.5", "PR", "Brand", "Trên 60% tin về thương hiệu là chủ đề chuyên môn", "Chấm tay", "Không"], ["2.2", "Data", "Technology", "Schema Organization có từ 8/10 thuộc tính, sameAs từ 2 kênh", "Quét website", "Không"], ["2.5", "Data", "Brand", "Có thực thể Wikidata trỏ đúng website; AI không nhầm thực thể", "Wikidata, Hỏi AI", "Không"], ["2.6", "Data", "Brand", "Mã số thuế, địa chỉ, liên hệ khớp 100% trên mọi nguồn", "Quét website, chấm tay", "Không"], ["3.3", "Data", "Technology", "Schema sản phẩm, dịch vụ, hỏi–đáp hợp lệ trên mọi trang sản phẩm", "Quét website", "Không"], ["4.6", "Data", "Brand", "Không còn mâu thuẫn dữ kiện giữa các nguồn", "So khớp nguồn", "Không"], ["6.4", "Data", "Content", "Giá, gói, phạm vi, thời gian triển khai công khai ở dạng máy đọc được", "Quét website", "B2B dự án: khung giá hoặc cách tính giá"], ["1.1", "Technology", "", "100% bot tìm kiếm AI được phép; không bị tường lửa chặn", "Quét website", "Không"], ["1.2", "Technology", "", "Nội dung chính có trong HTML gốc; có sitemap; dùng HTTPS", "Quét website", "Không"], ["1.3", "Technology", "Data", "Website chính thức đứng đầu khi tìm tên trên Google và Bing", "Chấm tay", "Không"], ["6.6", "Technology", "Content", "Có liên kết gọi, email, biểu mẫu và đặt lịch hoặc báo giá trực tuyến", "Quét website", "Không"]];
  const OUTCOME_IDS = ["1.6", "3.5", "5.6", "6.2", "6.3"];
  const LEVELS = [[1, "Rời rạc", "Dưới 40", "Mỗi kênh nói một kiểu; chưa ai sở hữu; chưa đo"], [2, "Chuẩn hóa", "40–59", "Có nguồn sự thật và quy ước chung, áp dụng trên kênh sở hữu"], [3, "Kiểm chứng", "60–79", "Bên thứ ba và dữ liệu máy đọc được xác nhận điều thương hiệu nói"], [4, "Dẫn dắt", "Từ 80", "Được nguồn khác trích dẫn, AI dùng làm căn cứ; có quy trình duy trì và đo hằng tháng"]];
  const TARGET_TEXT = {"Brand": ["Một nguồn sự thật duy nhất", "Từ \"mỗi kênh tự mô tả mình\" sang \"một Brand Truth Sheet được lãnh đạo duyệt, mọi kênh dùng chung tên, định vị và điểm khác biệt\"."], "Content": ["Trả lời được mọi câu hỏi mua hàng", "Từ \"tin hoạt động công ty\" sang \"nội dung trả lời thẳng câu hỏi của khách, có số liệu và cập nhật định kỳ\"."], "PR": ["Được bên thứ ba xác nhận", "Từ \"đo reach và số bài\" sang \"mỗi hoạt động truyền thông phải làm dày lớp bằng chứng\"."], "Data": ["Dữ kiện máy đọc được và nhất quán", "Từ \"thông tin nằm rải rác trong văn bản\" sang \"mọi dữ kiện cốt lõi có cấu trúc, nhất quán ở mọi nguồn, thực thể được định danh duy nhất\"."], "Technology": ["AI đọc được và đi thẳng tới hành động", "Từ \"website làm cho người xem\" sang \"website mà AI đọc được trọn vẹn và AI agent hoàn tất được bước tiếp theo\"."]};
  const DEFAULT_TARGET = 80;
  const OUT = [
    { id: '1.6', name: 'AI nhận ra thương hiệu khi hỏi thẳng tên', target: 0.75, unit: '%', tgt: 'Từ 75% lượt hỏi' },
    { id: '3.5', name: 'AI mô tả đúng lĩnh vực, sản phẩm, định vị', target: 3.5, unit: '/4', tgt: 'Trung bình từ 3,5/4' },
    { id: '5.6', name: 'AI nhắc tới thương hiệu theo chủ đề', target: 0.70, unit: '%', tgt: 'Từ 70% lượt hỏi' },
    { id: '6.2', name: 'AI đề xuất thương hiệu khi khách hỏi mua', target: 0.60, unit: '%', tgt: 'Từ 60% lượt hỏi' },
    { id: '6.3', name: 'Vị trí và sắc thái khi được đề xuất', target: 0.60, unit: '%', tgt: 'Top 3 ở từ 60% câu trả lời; không có sắc thái tiêu cực' },
    { id: 'SOV', name: 'Share of voice so với đối thủ đã duyệt', target: 2, unit: 'hạng', tgt: 'Dẫn đầu hoặc thứ hai trong nhóm đối thủ' },
  ];
  const TIERS = { tai_san: 'Tài sản', quy_trinh: 'Quy trình', con_nguoi: 'Con người và quy chế', he_thong: 'Hệ thống' };
  const byId = Object.fromEntries(ROWS.map(r => [r[0], r]));
  const pillarOf = id => (byId[id] ? byId[id][1] : OUTCOME_IDS.includes(id) ? 'Kết quả' : null);
  const levers = p => ROWS.filter(r => r[1] === p).map(r => r[0]);
  function levelOf(score) { return score < 40 ? LEVELS[0] : score < 60 ? LEVELS[1] : score < 80 ? LEVELS[2] : LEVELS[3]; }
  /** scoreOf(id) → 0–4 hoặc null. targets: {Brand:{t,reason}}. Quyết định 5: trọng số bằng nhau; quyết định 7: cần ≥ 2/3 tiêu chí đã chấm. */
  function pillarScores(scoreOf, targets = {}) {
    return P.map(p => {
      const ids = levers(p), vals = ids.map(scoreOf).filter(v => v != null && Number.isFinite(Number(v))).map(Number);
      const n = ids.length, scored = vals.length, avg = scored ? vals.reduce((a, b) => a + b, 0) / scored : null;
      const score = avg == null ? null : avg / 4 * 100, enough = scored >= Math.ceil(n * 2 / 3);
      const tg = targets[p] && Number.isFinite(Number(targets[p].t)) ? Math.min(100, Math.max(40, Number(targets[p].t))) : DEFAULT_TARGET;
      return { pillar: p, n, scored, avg, score, enough, level: enough && score != null ? levelOf(score) : null, target: tg,
        reason: tg !== DEFAULT_TARGET && targets[p] ? String(targets[p].reason || '') : '', gap: score == null ? null : Math.max(0, tg - score),
        reached: enough && score != null && score >= tg, missing: ids.filter(id => scoreOf(id) == null) };
    });
  }
  /** Thứ tự phụ thuộc: Data, Technology làm nền → Brand → Content, PR. */
  function dependency(ps) {
    const g = p => ps.find(x => x.pillar === p), weak = ['Data', 'Technology'].filter(p => g(p).score != null && g(p).score < 60);
    if (weak.length) return { level: 'nen', text: `${weak.join(' và ')} dưới 60 điểm: củng cố nền trước khi đầu tư lớn cho Content và PR.` };
    if (g('Brand').score != null && g('Brand').score < 60) return { level: 'brand', text: 'Brand dưới 60 điểm: ban hành Brand Truth Sheet trước khi khuếch đại bằng Content và PR.' };
    if (ps.every(x => x.score == null)) return null;
    return { level: 'ok', text: 'Nền đã ổn: có thể khuếch đại bằng Content và PR.' };
  }
  const wilsonLo = (k, n) => { if (!n) return null; const z = 1.96, p = k / n, d = 1 + z * z / n, c = p + z * z / (2 * n), m = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)); return Math.max(0, (c - m) / d); };
  /** m: {b:{k,n}, acc:[...], t:{k,n}, s:{k,n}, top3:{k,n,neg}, sov:{rank,of}}. Quyết định 6: xét đạt theo tỷ lệ đo được, cảnh báo khi cận dưới KTC 95% thấp hơn mức đích. */
  function outcomes(m) {
    const rate = (o, x) => { if (!x || !x.n) return { ...o, value: null, status: 'Chưa đo' }; const v = x.k / x.n, lo = wilsonLo(x.k, x.n);
      return { ...o, value: v, k: x.k, n: x.n, lo, status: v >= o.target ? 'Đạt' : 'Chưa đạt', warn: v >= o.target && lo < o.target }; };
    return OUT.map(o => {
      if (o.id === '1.6') return rate(o, m.b);
      if (o.id === '5.6') return rate(o, m.t);
      if (o.id === '6.2') return rate(o, m.s);
      if (o.id === '3.5') { const a = (m.acc || []).filter(Number.isFinite); if (!a.length) return { ...o, value: null, status: 'Chưa đo' };
        const v = a.reduce((x, y) => x + y, 0) / a.length; return { ...o, value: v, n: a.length, status: v >= o.target ? 'Đạt' : 'Chưa đạt' }; }
      if (o.id === '6.3') { const r = rate(o, m.top3); if (r.value == null) return r; const neg = (m.top3 && m.top3.neg) || 0;
        return { ...r, neg, status: r.value >= o.target && neg === 0 ? 'Đạt' : 'Chưa đạt' }; }
      if (!m.sov || !m.sov.of || m.sov.of < 2 || m.sov.rank == null) return { ...o, value: null, status: 'Chưa đo', note: 'Cần ít nhất 1 đối thủ đã duyệt và dữ liệu nhóm C, S.' };
      return { ...o, value: m.sov.rank, of: m.sov.of, status: m.sov.rank <= o.target ? 'Đạt' : 'Chưa đạt' };
    });
  }
  /** Trụ cột của một việc trong kế hoạch: trụ cột chiếm nhiều tiêu chí đòn bẩy nhất. */
  function pillarOfItem(ids) {
    const c = {}; (ids || []).forEach(id => { const p = byId[id] && byId[id][1]; if (p) c[p] = (c[p] || 0) + 1; });
    const top = Object.entries(c).sort((a, b) => b[1] - a[1] || P.indexOf(a[0]) - P.indexOf(b[0]))[0];
    return top ? top[0] : null;
  }
  /** Kiểm chứng đầu ra AI: chỉ giữ thay đổi gắn mã tiêu chí của chính trụ cột và có căn cứ. */
  function cleanDiagnosis(p, raw) {
    const own = new Set(levers(p)), s = (x, n) => String(x == null ? '' : x).trim().slice(0, n);
    const changes = [], dropped = [];
    for (const c of (raw && Array.isArray(raw.thay_doi) ? raw.thay_doi : []).slice(0, 12)) {
      const crit = (Array.isArray(c && c.criteria) ? c.criteria : []).map(String).filter(id => own.has(id));
      const item = { tier: TIERS[c && c.tang] ? c.tang : 'tai_san', from: s(c && c.tu, 300), to: s(c && c.sang, 300), criteria: [...new Set(crit)].slice(0, 6),
        basis: s(c && c.can_cu, 400), first: s(c && c.viec_dau_tien, 300), owner: s(c && c.phu_trach, 40) };
      if (!item.criteria.length || !item.basis || !item.to) dropped.push(item); else changes.push(item);
    }
    changes.sort((a, b) => Object.keys(TIERS).indexOf(a.tier) - Object.keys(TIERS).indexOf(b.tier));
    return { now: s(raw && raw.hien_trang, 800), risk: s(raw && raw.rui_ro, 400), changes, dropped: dropped.length };
  }
  root.CheckAIPillars = { P, ROWS, OUTCOME_IDS, LEVELS, TARGET_TEXT, DEFAULT_TARGET, OUT, TIERS, pillarOf, levers, levelOf, pillarScores, dependency, outcomes, pillarOfItem, cleanDiagnosis };
})(globalThis);
