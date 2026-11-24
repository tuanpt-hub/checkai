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
        check("không có lỗi JavaScript", not errs, errs)
        await b.close()
    print("\nTẤT CẢ ĐẠT" if ok else "\nCÓ LỖI"); sys.exit(0 if ok else 1)
asyncio.run(main())
