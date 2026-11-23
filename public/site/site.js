/* brand.ai.vn – dùng chung cho landing, trang kiểm tra và trang báo cáo. */
(function () {
  var UTM = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'];
  // Ghi nguồn truy cập lần đầu trong phiên (UTM, trang giới thiệu tới) để biết khách đến từ đâu, kể cả từ ChatGPT, Perplexity.
  try {
    if (!sessionStorage.getItem('bai_attr')) {
      var q = new URLSearchParams(location.search), utm = {};
      UTM.forEach(function (k) { if (q.get(k)) utm[k] = q.get(k).slice(0, 120); });
      var ref = document.referrer && document.referrer.indexOf(location.origin) !== 0 ? document.referrer.slice(0, 300) : '';
      sessionStorage.setItem('bai_attr', JSON.stringify({ utm: utm, referrer: ref }));
    }
  } catch (e) { /* trình duyệt chặn bộ nhớ phiên: bỏ qua */ }

  var cfgPromise = null, tsPromise = null;
  var BAI = {
    attr: function () { try { return JSON.parse(sessionStorage.getItem('bai_attr')) || { utm: {}, referrer: '' }; } catch (e) { return { utm: {}, referrer: '' }; } },
    api: async function (path, body, headers) {
      var r;
      try { r = await fetch(path, { method: body ? 'POST' : 'GET', headers: Object.assign({ 'Content-Type': 'application/json' }, headers || {}), body: body ? JSON.stringify(body) : undefined }); }
      catch (e) { throw { code: 'network', message: 'Không kết nối được máy chủ. Kiểm tra mạng và thử lại.' }; }
      var j = null; try { j = await r.json(); } catch (e) { /* bỏ qua */ }
      if (!r.ok) throw (j && j.error) || { code: 'http_' + r.status, message: 'Máy chủ đang bận. Thử lại sau ít phút.' };
      return j;
    },
    config: function () { if (!cfgPromise) cfgPromise = BAI.api('/api/hc').catch(function () { return { turnstileSiteKey: null, engines: [], open: true }; }); return cfgPromise; },
    /** Gắn Cloudflare Turnstile vào ô el; trả hàm lấy mã xác minh. Chưa cấu hình khóa (chạy thử) thì bỏ qua. */
    turnstile: async function (el) {
      var cfg = await BAI.config();
      if (!cfg.turnstileSiteKey || !el) { if (el) el.hidden = true; return { token: function () { return ''; }, reset: function () {} }; }
      if (!tsPromise) tsPromise = new Promise(function (ok, fail) {
        var s = document.createElement('script'); s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'; s.async = true;
        s.onload = function () { ok(window.turnstile); }; s.onerror = function () { fail(new Error('turnstile')); }; document.head.appendChild(s);
      });
      var ts = await tsPromise, id = ts.render(el, { sitekey: cfg.turnstileSiteKey, theme: 'dark', language: 'auto' });
      return { token: function () { return ts.getResponse(id) || ''; }, reset: function () { ts.reset(id); } };
    },
    msg: function (el, text, kind) { if (!el) return; el.textContent = text || ''; el.style.color = kind === 'err' ? '#FFB3C1' : kind === 'ok' ? '#B6F35A' : '#D7E3F7'; },
    /** Biểu mẫu đặt lịch tư vấn trên landing. */
    leadForm: async function (form) {
      if (!form) return;
      var box = form.querySelector('.ts-box'), msg = form.querySelector('.form-msg'), btn = form.querySelector('button[type=submit]');
      var ts = await BAI.turnstile(box).catch(function () { BAI.msg(msg, 'Không tải được bước xác minh chống bot. Tải lại trang.', 'err'); return null; });
      form.addEventListener('submit', async function (ev) {
        ev.preventDefault();
        var v = function (n) { var x = form.elements[n]; return x ? String(x.value || '').trim() : ''; };
        if (!v('name')) return BAI.msg(msg, 'Vui lòng nhập họ tên.', 'err');
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v('email'))) return BAI.msg(msg, 'Email chưa đúng định dạng.', 'err');
        if (!form.elements.consent.checked) return BAI.msg(msg, 'Vui lòng đồng ý với việc xử lý dữ liệu cá nhân để NetSpace liên hệ.', 'err');
        btn.disabled = true; BAI.msg(msg, 'Đang gửi…');
        try {
          var a = BAI.attr();
          await BAI.api('/api/hc?op=lead', { name: v('name'), company: v('company'), email: v('email'), phone: v('phone'), website: v('website'), package: v('package'),
            consent: true, turnstile: ts ? ts.token() : '', utm: a.utm, referrer: a.referrer });
          form.reset(); BAI.msg(msg, 'Đã nhận yêu cầu. Chuyên viên NetSpace sẽ liên hệ với anh/chị sớm.', 'ok');
        } catch (e) { BAI.msg(msg, e.message || 'Chưa gửi được. Thử lại sau ít phút.', 'err'); if (ts) ts.reset(); }
        finally { btn.disabled = false; }
      });
    },
  };
  window.BAI = BAI;
})();
