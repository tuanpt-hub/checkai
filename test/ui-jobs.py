"""Kiểm thử trình duyệt: Hỏi AI chạy nền – đóng tab giữa chừng, mở lại thì kết quả đã được gộp vào audit (đúng một lần).
Chạy:  npm run dev:fake   rồi   python3 test/ui-jobs.py"""
import asyncio, json, os, sys
from playwright.async_api import async_playwright
BASE = os.environ.get("BASE", "http://localhost:3100")
ok = True
def check(name, cond, extra=""):
    global ok
    print(("  ✓ " if cond else "  ✗ ") + name + ((" – " + str(extra)[:240]) if extra and not cond else "")); ok = ok and bool(cond)
async def login(pg):
    await pg.goto(BASE + "/"); await pg.wait_for_selector('#login:not([hidden]),#app:not([hidden])')
    if await pg.evaluate("!document.querySelector('#login').hidden"):
        await pg.fill('#lgEmail', 'staff@netspace.vn'); await pg.fill('#lgPass', 'Mat-khau-1'); await pg.click('#lgBtn')
    await pg.wait_for_selector('#app:not([hidden])'); await pg.wait_for_timeout(400)
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(); errs = []
        ctx = await b.new_context(viewport={"width": 1300, "height": 900})
        pg = await ctx.new_page(); pg.on('pageerror', lambda e: errs.append(str(e)))
        await login(pg)
        await pg.click('#newAudit'); await pg.wait_for_timeout(200); await pg.click('[data-act="seed"]')
        await pg.wait_for_function("document.querySelector('#saveState').textContent==='Đã lưu'", timeout=15000)
        aid = await pg.evaluate("cur"); before = await pg.evaluate("Object.keys(A().probe).filter(k=>k.startsWith('B')).length")
        # Tab đầu không được phép gộp kết quả: chắc chắn kết quả chỉ có thể vào audit qua lần mở lại sau khi đóng tab
        await pg.route('**/api/probe?op=results', lambda r: r.abort())
        await pg.evaluate("tab='probe';renderAll()"); await pg.wait_for_timeout(300)
        await pg.click('[data-act="run"][data-g="B"]'); await pg.wait_for_function("!!activeJob(A(),'probe')", timeout=10000)
        check("bấm chạy là giao việc cho máy chủ (thông báo có thể đóng tab)", "chạy nền" in await pg.inner_text('.okbox') and "đóng tab" in await pg.inner_text('#view'))
        check("ô tiến độ chạy nền có nút Dừng; menu Hỏi AI có dấu ⟳", await pg.is_visible('.job-box [data-act="jobCancel"]') and await pg.evaluate("!!document.querySelector('nav.steps small.job-run')"))
        await pg.close()
        print("Đã đóng tab khi việc đang chạy")
        await asyncio.sleep(4)
        pg2 = await ctx.new_page(); pg2.on('pageerror', lambda e: errs.append(str(e)))
        await login(pg2)
        await pg2.evaluate(f"id=>{{const s=document.querySelector('#auditSel');s.value=id;s.dispatchEvent(new Event('change',{{bubbles:true}}))}}", aid)
        await pg2.wait_for_function(f"(jobsByAudit['{aid}']||[]).some(j=>j.appliedAt)", timeout=60000)
        await pg2.wait_for_function("document.querySelector('#saveState').textContent==='Đã lưu'", timeout=15000)
        n = await pg2.evaluate("Object.keys(A().probe).filter(k=>k.startsWith('B')).length")
        check("mở lại: kết quả việc chạy nền đã được gộp vào audit", n == 6 and before == 0, f"{before} → {n}")
        await pg2.evaluate("tab='probe';renderAll()"); await pg2.wait_for_timeout(300)
        check("thông báo đã lưu kết quả từ việc chạy nền", "từ việc chạy nền" in await pg2.inner_text('#view'))
        srv = await pg2.evaluate(f"api('/api/audits/{aid}').then(r=>Object.keys(r.audit.probe||{{}}).filter(k=>k.startsWith('B')).length)")
        check("kết quả đã lưu lên máy chủ", srv == 6, srv)
        again = await pg2.evaluate(f"api('/api/probe?op=list&auditId={aid}').then(r=>r.jobs.filter(j=>j.appliedAt).length)")
        check("việc chỉ được gộp một lần", again == 1, again)
        print("Giai đoạn 2 – tác vụ soạn/chấm chạy nền")
        # 1) Phân tích nội dung: kết quả tự hiện, không cần bấm gì
        await pg2.evaluate("tab='score';renderAll()"); await pg2.wait_for_timeout(300)
        await pg2.evaluate("document.querySelectorAll('#view details').forEach(d=>d.open=true)"); await pg2.wait_for_timeout(200)
        await pg2.fill('#anContent', 'NetSpace là công ty công nghệ và truyền thông số tại Việt Nam, vận hành mạng lưới kênh và KOL, cung cấp dịch vụ truyền thông thương hiệu cho doanh nghiệp. ' * 2)
        n0 = await pg2.evaluate("(jobsByAudit[cur]||[]).filter(j=>j.kind==='gen:content'&&j.appliedAt).length")
        await pg2.click('[data-act="an1"]'); await pg2.wait_for_function("!!activeJob(A(),'gen:content')||(jobsByAudit[cur]||[]).some(j=>j.kind==='gen:content')", timeout=10000)
        # 2) Đang gõ dở khi việc nền xong: chữ không bị mất
        await pg2.evaluate("document.querySelectorAll('#view details').forEach(d=>d.open=true)"); await pg2.wait_for_timeout(200)
        await pg2.click('#anSources'); await pg2.type('#anSources', 'Đang gõ dở ', delay=30)
        await pg2.wait_for_function(f"(jobsByAudit[cur]||[]).filter(j=>j.kind==='gen:content'&&j.appliedAt).length>{n0}", timeout=60000); await pg2.wait_for_timeout(400)
        check("đang gõ khi việc nền xong: chữ và con trỏ được giữ", await pg2.evaluate("document.activeElement&&document.activeElement.id==='anSources'&&document.activeElement.value.includes('Đang gõ dở')"))
        await pg2.evaluate("document.activeElement.blur()"); await pg2.wait_for_timeout(300)
        check("phân tích nội dung chạy nền: kết quả tự hiện trên trang", await pg2.evaluate("!!(A().analysis&&A().analysis.content&&A().analysis.content.rewrite!==undefined)") and "Đã phân tích nội dung" in await pg2.inner_text('#view'))
        # 3) Blueprint: đóng tab giữa chừng, mở lại đã có
        await pg2.evaluate("tab='fix';renderAll()"); await pg2.wait_for_timeout(300)
        await pg2.route('**/api/probe?op=results', lambda r: r.abort())
        bp0 = await pg2.evaluate("Object.keys((A().blueprint||{}).pillars||{}).length")
        await pg2.click('[data-act="bpGen"]'); await pg2.wait_for_function("!!activeJob(A(),'gen:bp')", timeout=10000)
        check("Blueprint: ô chạy nền có nút Dừng; menu có dấu ⟳", await pg2.is_visible('.job-box [data-act="jobCancel"]') and await pg2.evaluate("!!document.querySelector('nav.steps small.job-run')"))
        await pg2.close(); await asyncio.sleep(3)
        pg3 = await ctx.new_page(); pg3.on('pageerror', lambda e: errs.append(str(e))); await login(pg3)
        await pg3.evaluate(f"id=>{{const s=document.querySelector('#auditSel');s.value=id;s.dispatchEvent(new Event('change',{{bubbles:true}}))}}", aid)
        await pg3.wait_for_function(f"(jobsByAudit['{aid}']||[]).some(j=>j.kind==='gen:bp'&&j.appliedAt)", timeout=60000); await pg3.wait_for_timeout(500)
        bp1 = await pg3.evaluate("Object.keys((A().blueprint||{}).pillars||{}).length")
        check("Blueprint chạy nền: đóng tab giữa chừng, mở lại đã có chẩn đoán", bp1 > bp0, f"{bp0} → {bp1}")
        check("không có lỗi JavaScript", not errs, errs)
        await b.close()
    print("\nTẤT CẢ ĐẠT" if ok else "\nCÓ LỖI"); sys.exit(0 if ok else 1)
asyncio.run(main())
