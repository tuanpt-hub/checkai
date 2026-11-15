/* Chuyển dữ liệu quét website, thực thể và kiểm chứng claim thành điểm gợi ý (0–4). Chuyên viên vẫn là người quyết định. */
(function(root) {
  const DAY = 86400000;
  const pct = x => Math.round(x * 100) + '%';
  function newestDate(scan) {
    const ds = [scan.sitemap && scan.sitemap.latest, ...[scan.home, scan.about].filter(Boolean).flatMap(p => [p.dates && p.dates.dateModified, p.dates && p.dates.lastModified])]
      .map(d => Date.parse(d)).filter(Number.isFinite);
    return ds.length ? Math.max(...ds) : null;
  }
  function fromScan(scan) {
    const s = {};
    if (!scan || !scan.home) return s;
    const pages = [scan.home, scan.about].filter(p => p && p.status === 200);
    const any = f => pages.some(f), sum = f => pages.reduce((n, p) => n + (f(p) || 0), 0);
    // 1.1 Quyền truy cập của AI crawler
    const bots = (scan.robots && scan.robots.bots) || {}, search = Object.entries(bots).filter(([, b]) => b.kind === 'search');
    const allowed = search.filter(([, b]) => b.allowed).length;
    const waf = scan.wafTest && Object.entries(scan.wafTest.bots || {}).filter(([, st]) => st && st >= 400 && (scan.wafTest.base || 0) < 400).map(([k]) => k);
    if (waf && waf.length) s['1.1'] = [1, `Website chặn bot theo user-agent (${waf.join(', ')} nhận mã lỗi trong khi trình duyệt thường vào được) – kiểm tra tường lửa/CDN.`];
    else if (!scan.robots || !scan.robots.found) s['1.1'] = [3, 'Không có robots.txt: mặc định cho phép mọi bot; nên khai báo rõ quyền cho các bot tìm kiếm AI.'];
    else if (search.length) {
      const r = allowed / search.length;
      s['1.1'] = [r === 1 ? 4 : r >= .7 ? 3 : r >= .4 ? 2 : r > 0 ? 1 : 0, `robots.txt cho phép ${allowed}/${search.length} bot tìm kiếm AI${allowed < search.length ? ' (đang chặn: ' + search.filter(([, b]) => !b.allowed).map(([k]) => k).join(', ') + ')' : ''}.`];
    }
    // 1.2 Khả năng đọc & lập chỉ mục
    const h = scan.home;
    if (h.status !== 200) s['1.2'] = [0, `Trang chủ trả mã ${h.status}.`];
    else if (/noindex/i.test((h.robotsMeta || '') + ' ' + (h.xRobots || ''))) s['1.2'] = [0, 'Trang chủ đặt noindex – công cụ tìm kiếm và AI không lập chỉ mục.'];
    else {
      let v = 4; const why = [];
      if (h.words < 150) { v -= 2; why.push(`HTML gốc chỉ có ${h.words} từ (nội dung phụ thuộc JavaScript)`); } else why.push(`HTML gốc có ${h.words} từ`);
      if (!(scan.sitemap && scan.sitemap.found)) { v -= 1; why.push('không tìm thấy sitemap'); } else why.push(`sitemap ${scan.sitemap.urls} URL`);
      if (!scan.https) { v -= 1; why.push('chưa dùng HTTPS'); }
      s['1.2'] = [Math.max(0, v), why.join('; ') + '.'];
    }
    // 1.5 Độ mới
    const newest = newestDate(scan), at = Date.parse(scan.at) || Date.now();
    if (newest) {
      const days = Math.round((at - newest) / DAY);
      s['1.5'] = [days <= 90 ? 4 : days <= 180 ? 3 : days <= 365 ? 2 : days <= 730 ? 1 : 0, `Ngày cập nhật mới nhất tìm thấy: ${new Date(newest).toISOString().slice(0, 10)} (${days} ngày trước). Chưa kiểm tra mạng xã hội và bài báo.`];
    } else if (h.dates && h.dates.copyrightYear) s['1.5'] = [h.dates.copyrightYear >= new Date(at).getFullYear() ? 2 : 1, `Chỉ thấy năm bản quyền ${h.dates.copyrightYear}; không có ngày cập nhật trong sitemap hay dữ liệu cấu trúc.`];
    // 2.2 Dữ liệu có cấu trúc về tổ chức
    const org = pages.map(p => p.org).filter(Boolean).sort((a, b) => b.fields.length - a.fields.length)[0];
    if (!org) s['2.2'] = [0, 'Không thấy JSON-LD Organization trên trang chủ và trang giới thiệu.'];
    else {
      const n = org.fields.length;
      s['2.2'] = [n >= 8 && org.sameAs >= 2 ? 4 : n >= 6 ? 3 : n >= 3 ? 2 : 1, `Organization có ${n}/10 thuộc tính (${org.fields.join(', ')}); sameAs: ${org.sameAs} liên kết.`];
    }
    // 2.4 Kênh chính thức và liên kết chéo
    const social = [...new Set(pages.flatMap(p => p.social || []))], sameAs = org ? org.sameAs : 0;
    s['2.4'] = [social.length >= 3 && sameAs >= 2 ? 4 : social.length >= 2 ? 3 : social.length === 1 ? 2 : 1, `Website liên kết tới ${social.length} kênh (${social.join(', ') || 'không có'}); sameAs ${sameAs}. Chưa kiểm tra liên kết ngược và tích xác minh.`];
    // 2.6 Định danh pháp lý trên website
    const nap = [any(p => p.phones > 0 || p.tel > 0), any(p => p.emails > 0 || p.mailto > 0), any(p => p.addressHint), any(p => p.taxHint), any(p => p.legalNameFound)];
    const labels = ['điện thoại', 'email', 'địa chỉ', 'mã số thuế', 'tên pháp lý'];
    s['2.6'] = [Math.round(nap.filter(Boolean).length / 5 * 4), `Có trên website: ${labels.filter((_, i) => nap[i]).join(', ') || 'không'}; thiếu: ${labels.filter((_, i) => !nap[i]).join(', ') || 'không'}. Chưa đối chiếu cổng đăng ký doanh nghiệp.`];
    // 3.3 Schema sản phẩm/dịch vụ/FAQ
    const types = new Set(pages.flatMap(p => p.schemaTypes || []));
    const prod = ['Product', 'Service', 'Offer', 'OfferCatalog'].some(t => types.has(t)), faq = types.has('FAQPage');
    s['3.3'] = [prod && faq && types.has('Offer') ? 4 : prod && faq ? 3 : prod || faq ? 2 : types.size ? 1 : 0, `Kiểu schema tìm thấy: ${[...types].join(', ') || 'không có'}. Chỉ quét trang chủ và trang giới thiệu.`];
    // 6.4 Dữ liệu quyết định (giá)
    const price = pages.map(p => p.price || {});
    const cur = price.reduce((n, x) => n + (x.currency || 0), 0), offer = price.some(x => x.offerSchema), words = price.some(x => x.priceWords), contactOnly = price.some(x => x.contactOnly);
    s['6.4'] = [offer ? 4 : cur > 0 ? 3 : words ? 2 : contactOnly ? 1 : 0, offer ? 'Có schema Offer/giá.' : cur > 0 ? `Có ${cur} con số giá công khai.` : words ? 'Có nhắc bảng giá/báo giá nhưng không có con số.' : contactOnly ? 'Chỉ có lời mời liên hệ/nhận tư vấn, không công bố giá.' : 'Không thấy dữ liệu giá.'];
    // 6.6 Đường dẫn hành động
    const acts = [sum(p => p.tel) > 0, sum(p => p.mailto) > 0, sum(p => p.forms) > 0, any(p => p.booking)];
    const n6 = acts.filter(Boolean).length;
    s['6.6'] = [n6 >= 4 ? 4 : n6 === 3 ? 3 : n6 === 2 ? 2 : n6 === 1 ? 1 : 0, `Có: ${['liên kết gọi điện', 'liên kết email', 'biểu mẫu', 'đặt lịch/báo giá'].filter((_, i) => acts[i]).join(', ') || 'không có đường dẫn hành động rõ'}.`];
    return s;
  }
  function fromEntity(ent) {
    const s = {};
    if (!ent || !Array.isArray(ent.entities)) return s;
    const m = ent.entities.find(e => e.matched), others = ent.entities.filter(e => !e.matched).length;
    s['2.5'] = m ? [others ? 3 : 4, `Wikidata có thực thể ${m.id} trỏ đúng website${others ? `; còn ${others} thực thể trùng tên` : ''}.`]
      : [others ? 1 : 2, others ? `Wikidata có ${others} thực thể trùng tên nhưng không thực thể nào trỏ về website thương hiệu.` : 'Chưa có thực thể Wikidata cho thương hiệu.'];
    return s;
  }
  function fromClaims(checks, claims) {
    const list = claims.map(c => checks && checks[c]).filter(Boolean);
    if (!list.length) return {};
    const ok = list.filter(x => x.independent >= 2).length, r = ok / list.length;
    return { '4.1': [r >= .8 ? 4 : r >= .6 ? 3 : r >= .4 ? 2 : r >= .2 ? 1 : 0, `${ok}/${list.length} claim đã kiểm có từ 2 nguồn độc lập xác nhận (${pct(r)}); ${claims.length - list.length} claim chưa kiểm.`] };
  }
  root.CheckAIEvidence = { fromScan, fromEntity, fromClaims };
})(globalThis);
