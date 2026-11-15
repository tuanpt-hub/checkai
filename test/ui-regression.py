"""Kiểm thử giao diện trên trình duyệt thật (Playwright) cho các lỗi đã sửa.
Chạy:  npm run dev:fake   (cửa sổ khác)   rồi   python3 test/ui-regression.py
Cần: pip install playwright && playwright install chromium"""
import asyncio, json, sys, tempfile, os
from playwright.async_api import async_playwright
BASE = os.environ.get("BASE", "http://localhost:3100")
ok = True
def check(name, cond, extra=""):
    global ok
    print(("  ✓ " if cond else "  ✗ ") + name + ((" – " + str(extra)) if extra and not cond else ""))
    ok = ok and bool(cond)
async def login(pg):
    await pg.goto(BASE); await pg.wait_for_selector('#login:not([hidden]),#app:not([hidden])')
    if await pg.evaluate("!document.querySelector('#login').hidden"):
        await pg.fill('#lgEmail', 'staff@netspace.vn'); await pg.fill('#lgPass', 'Mat-khau-1'); await pg.click('#lgBtn')
    await pg.wait_for_selector('#app:not([hidden])'); await pg.wait_for_timeout(700)
async def saved(pg): await pg.wait_for_function("document.querySelector('#saveState').textContent==='Đã lưu'", timeout=15000)
async def server_audit(pg, id): return await pg.evaluate("id=>fetch('/api/audits/'+id,{headers:{'X-ABR':'1'}}).then(r=>r.json())", id)

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(); ctx = await b.new_context(viewport={"width": 1300, "height": 900}, accept_downloads=True)
        pg = await ctx.new_page(); errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        await login(pg)
        if await pg.query_selector('[data-act="seed"]'):
            await pg.click('[data-act="seed"]'); await saved(pg)
        id1 = await pg.evaluate("cur")
        await pg.click('#newAudit'); await pg.fill('#nb', 'Thương hiệu B'); await pg.click('[data-act="create"]'); await saved(pg)
        id2 = await pg.evaluate("cur")
        await pg.evaluate("id=>{const s=document.querySelector('#auditSel');s.value=id;s.dispatchEvent(new Event('change',{bubbles:true}))}", id1); await pg.wait_for_timeout(500)

        print("Lỗi 1 – đổi audit khi đang chạy")
        await pg.click('nav [data-tab="probe"]')
        async def slow(route):
            await asyncio.sleep(0.4); await route.continue_()
        await pg.route('**/api/probe', slow)
        await pg.click('[data-act="run"][data-g="B"]'); await pg.wait_for_timeout(600)
        locked = await pg.evaluate("['auditSel','newAudit','impBtn','delAudit'].every(i=>document.getElementById(i).disabled)")
        check("ô chọn audit, Tạo, Nhập, Xóa bị khóa khi đang chạy", locked)
        await pg.evaluate("id=>{const s=document.querySelector('#auditSel');s.disabled=false;s.value=id;s.dispatchEvent(new Event('change',{bubbles:true}))}", id2)
        check("đổi audit bằng mọi cách vẫn bị chặn (cur giữ nguyên)", await pg.evaluate("id=>cur===id", id1))
        await pg.wait_for_function("!busy", timeout=40000); await saved(pg)
        srv = await server_audit(pg, id1)
        nb = len([k for k in srv['audit'].get('probe', {}) if k.startswith('B')])
        check("6 kết quả nhóm B được lưu lên máy chủ đúng audit", nb == 6, nb)
        check("sau khi xong, các nút được mở khóa", await pg.evaluate("['auditSel','newAudit','impBtn'].every(i=>!document.getElementById(i).disabled)"))
        await pg.unroute('**/api/probe')

        print("Lỗi 2 – câu trả lời bị cắt được đánh dấu")
        async def trunc(route):
            await route.fulfill(status=200, content_type='application/json', body=json.dumps({"text": "NetSpace là công ty công nghệ và truyền thông (bị cắt", "model": "test-model", "sources": [], "queries": [], "truncated": True, "used": 1, "limit": 100}))
        await pg.route('**/api/probe', trunc)
        await pg.click('[data-act="run"][data-g="B"]'); await pg.wait_for_selector('.okbox', timeout=30000)
        check("thông báo có cảnh báo bị cắt", 'bị cắt' in await pg.inner_text('.okbox'))
        await pg.evaluate("document.querySelectorAll('.ptable details').forEach(d=>d.open=true)")
        check("bảng kết quả hiển thị dấu ⚠ bị cắt", '⚠ bị cắt' in await pg.inner_text('.ptable'))
        await pg.unroute('**/api/probe')

        print("Lỗi 4 – lỗi tải hiển thị rõ ràng và thử lại được")
        await saved(pg)
        await pg.route('**/api/audits', lambda r: r.fulfill(status=500, content_type='application/json', body=json.dumps({"error": {"code": "db_error", "message": "Không đọc được danh sách audit."}})))
        await pg.reload(); await pg.wait_for_selector('#app:not([hidden])'); await pg.wait_for_timeout(800)
        txt = await pg.inner_text('#view')
        check("lỗi danh sách: hiện thông báo lỗi, không hiện 'Bắt đầu audit đầu tiên'", 'Không đọc được danh sách audit' in txt and 'Bắt đầu audit đầu tiên' not in txt, txt[:80])
        await pg.unroute('**/api/audits'); await pg.click('[data-act="retryList"]'); await pg.wait_for_timeout(900)
        check("bấm Thử lại: tải được audit", await pg.evaluate("!!audits[cur]"))
        await pg.route('**/api/audits/*', lambda r: r.fulfill(status=500, content_type='application/json', body=json.dumps({"error": {"code": "db_error", "message": "Không đọc được audit."}})) if r.request.method == 'GET' else r.continue_())
        await pg.reload(); await pg.wait_for_selector('#app:not([hidden])'); await pg.wait_for_timeout(800)
        txt = await pg.inner_text('#view')
        check("lỗi một audit: hiện lỗi và nút Thử lại, không kẹt 'Đang tải audit…'", 'Không tải được audit' in txt and await pg.query_selector('[data-act="retryAudit"]') is not None, txt[:80])
        await pg.unroute('**/api/audits/*'); await pg.click('[data-act="retryAudit"]'); await pg.wait_for_timeout(900)
        check("bấm Thử lại: audit hiện ra", await pg.evaluate("!!audits[cur]"))

        print("Lỗi 5 – xuất/nhập JSON không mang biến nội bộ")
        await pg.click('nav [data-tab="result"]'); await pg.wait_for_timeout(300)
        async with pg.expect_download() as dl:
            await pg.click('[data-act="expjson"]')
        path = await (await dl.value).path(); exported = json.load(open(path, encoding='utf-8'))
        check("file xuất không có khóa bắt đầu bằng _", not [k for k in exported if k.startswith('_')], [k for k in exported if k.startswith('_')])
        dirty = dict(exported); dirty['id'] = 'import-test-01'; dirty['_conflict'] = {"by": "ai-do"}; dirty['_v'] = 9
        f = tempfile.NamedTemporaryFile('w', suffix='.json', delete=False, encoding='utf-8'); json.dump(dirty, f, ensure_ascii=False); f.close()
        await pg.set_input_files('#impFile', f.name); await pg.wait_for_timeout(500); await saved(pg)
        check("nhập file có _conflict/_v: audit vẫn lưu được, không hiện cảnh báo xung đột", await pg.evaluate("!audits[cur]._conflict && !document.querySelector('.warnbox')") and await pg.evaluate("cur==='import-test-01'"))

        check("không có lỗi JavaScript", not errs, errs)
        await b.close()
    print("\nTẤT CẢ ĐẠT" if ok else "\nCÓ LỖI"); sys.exit(0 if ok else 1)
asyncio.run(main())
