"""Kiểm thử trình duyệt cho AI Trust Blueprint (đợt 1): điểm và mức 5 trụ cột, chỉ số kết quả, mức đích theo ngành kèm lý do,
chẩn đoán từ → sang (lọc đề xuất thiếu căn cứ), kế hoạch theo trụ cột, xuất tài liệu và báo cáo.
Chạy:  npm run dev:fake   rồi   python3 test/ui-blueprint.py"""
import asyncio, os, sys
from playwright.async_api import async_playwright
BASE = os.environ.get("BASE", "http://localhost:3100")
ok = True
def check(name, cond, extra=""):
    global ok
    print(("  ✓ " if cond else "  ✗ ") + name + ((" – " + str(extra)[:220]) if extra and not cond else "")); ok = ok and bool(cond)
async def saved(pg): await pg.wait_for_function("document.querySelector('#saveState').textContent==='Đã lưu'", timeout=15000)
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(); ctx = await b.new_context(viewport={"width": 1300, "height": 900}, accept_downloads=True); pg = await ctx.new_page(); errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto(BASE); await pg.wait_for_selector('#login:not([hidden]),#app:not([hidden])')
        if await pg.evaluate("!document.querySelector('#login').hidden"):
            await pg.fill('#lgEmail', 'staff@netspace.vn'); await pg.fill('#lgPass', 'Mat-khau-1'); await pg.click('#lgBtn')
        await pg.wait_for_selector('#app:not([hidden])'); await pg.wait_for_timeout(700)
        await pg.click('#newAudit'); await pg.wait_for_timeout(200); await pg.click('[data-act="seed"]'); await saved(pg)
        await pg.click('nav [data-tab="fix"]'); await pg.wait_for_timeout(400)
        t = await pg.inner_text('#view')
        check("bước 6 trả lời câu hỏi 5 trụ cột", 'Brand, Content, PR, Data và Technology' in await pg.inner_text('header, .page-head, #view') or 'AI Trust Blueprint' in t)
        rows = await pg.evaluate("[...document.querySelectorAll('[data-ptarget]')].map(i=>i.dataset.ptarget)")
        check("bảng 5 trụ cột theo đúng thứ tự", rows == ['Brand', 'Content', 'PR', 'Data', 'Technology'], rows)
        ps = await pg.evaluate("pScores(audits[cur]).map(x=>[x.pillar,x.scored,x.n,x.score==null?null:Math.round(x.score),x.level&&x.level[1]])")
        check("mỗi trụ cột có số tiêu chí đã chấm và mức (hoặc chưa đủ dữ liệu)", all(len(r) == 5 for r in ps) and sum(r[2] for r in ps) == 31, ps)
        check("có nhận định thứ tự ưu tiên", 'Thứ tự ưu tiên' in t)
        check("bảng chỉ số kết quả có 6 dòng, chưa đo trước khi hỏi AI", t.count('Chưa đo') >= 4 and 'Share of voice so với đối thủ đã duyệt' in t)

        print("Mức đích theo ngành")
        await pg.fill('[data-ptarget="Brand"]', '70'); await pg.press('[data-ptarget="Brand"]', 'Tab'); await pg.wait_for_selector('[data-preason="Brand"]')
        await pg.fill('[data-preason="Brand"]', 'Doanh nghiệp nhỏ, 5 chủ đề'); await saved(pg)
        check("chỉnh mức đích Brand thành 70 kèm lý do", await pg.evaluate("JSON.stringify(audits[cur].pillarTargets)") == '{"Brand":{"t":70,"reason":"Doanh nghiệp nhỏ, 5 chủ đề"}}')

        print("Chẩn đoán từ → sang")
        todo = await pg.evaluate("pScores(audits[cur]).filter(x=>!x.reached).length")
        await pg.click('[data-act="bpGen"]'); await pg.wait_for_function("!busy", timeout=60000); await pg.wait_for_timeout(300)
        n = await pg.evaluate("Object.keys(audits[cur].blueprint.pillars).length")
        check("soạn chẩn đoán cho mọi trụ cột chưa đạt đích", n == todo, (n, todo))
        bp = await pg.evaluate("Object.values(audits[cur].blueprint.pillars).map(d=>[d.changes.length,d.dropped,d.changes.every(c=>c.criteria.length&&c.basis)])")
        check("đề xuất thiếu căn cứ hoặc mã tiêu chí sai đều bị loại", all(r[1] == 2 and r[2] for r in bp), bp)
        check("bảng từ → sang có tầng, căn cứ, việc làm ngay", 'Quy trình' in await pg.inner_text('#view') and 'Họp chốt quy trình' in await pg.inner_text('#view') and 'đã loại 2 đề xuất' in await pg.inner_text('#view'))
        await pg.click('[data-act="bpOne"][data-p="PR"]'); await pg.wait_for_function("!busy", timeout=30000)
        check("soạn lại riêng một trụ cột", 'Đã soạn chẩn đoán cho 1 trụ cột' in await pg.inner_text('.okbox'))

        print("Chỉ số kết quả sau khi hỏi AI")
        await pg.click('nav [data-tab="probe"]'); await pg.wait_for_timeout(300); await pg.click('[data-act="run"][data-g="B"]'); await pg.wait_for_selector('.okbox', timeout=60000)
        await pg.click('nav [data-tab="fix"]'); await pg.wait_for_timeout(300)
        o16 = await pg.evaluate("bpMeasures(audits[cur]).find(o=>o.id==='1.6')")
        check("1.6 lấy từ nhóm B và có đánh giá", o16['n'] == 18 and o16['status'] in ('Đạt', 'Chưa đạt'), o16)

        print("Kế hoạch theo trụ cột và xuất tài liệu")
        await pg.click('[data-act="plan"]'); await pg.wait_for_function("!busy", timeout=30000); await pg.wait_for_timeout(200)
        check("mỗi việc trong kế hoạch có nhãn trụ cột", await pg.evaluate("document.querySelectorAll('.plan-card .p-chip').length") >= 2)
        await pg.click('[data-act="planBy"][data-v="pillar"]'); await pg.wait_for_timeout(200)
        heads = await pg.evaluate("[...document.querySelectorAll('.plan-card')].length && [...document.querySelectorAll('#view h3.small')].map(h=>h.textContent)")
        check("nhóm kế hoạch theo trụ cột", 'Technology' in heads and 'Brand' in heads, heads)
        async with pg.expect_download() as dl:
            await pg.click('[data-act="bpExport"]')
        f = await dl.value; md = open(await f.path(), encoding='utf-8').read()
        check("tệp AI Trust Blueprint (.md) đủ các phần", f.suggested_filename.startswith('ai-trust-blueprint-') and all(x in md for x in ['# AI Trust Blueprint – NetSpace', '| Trụ cột | Điểm |', '**Chỉ số kết quả**', '| Tầng | Từ | Sang |', 'Mức đích Brand chỉnh thành 70: Doanh nghiệp nhỏ', '## Kế hoạch hành động theo trụ cột', '## Phương pháp và giới hạn']), md[:400])
        check("không có mã tiêu chí 9.9 bị bịa trong tài liệu", '9.9' not in md)
        await pg.click('nav [data-tab="result"]'); await pg.wait_for_timeout(300); await pg.click('[data-act="showmd"]')
        check("báo cáo audit có mục AI Trust Blueprint", 'AI Trust Blueprint – 5 trụ cột' in await pg.inner_text('#mdBox'))
        await saved(pg)
        srv = await pg.evaluate("fetch('/api/audits/'+cur,{headers:{'X-ABR':'1'}}).then(r=>r.json()).then(j=>({bp:Object.keys((j.audit.blueprint||{}).pillars||{}).length,t:(j.audit.pillarTargets||{}).Brand}))")
        check("chẩn đoán và mức đích được lưu lên máy chủ", srv['bp'] == todo and srv['t']['t'] == 70, srv)
        m = await ctx.new_page(); await m.set_viewport_size({"width": 380, "height": 800}); await m.goto(BASE); await m.wait_for_selector('#app:not([hidden])'); await m.wait_for_timeout(700)
        await m.evaluate("tab='fix';renderAll()"); await m.wait_for_timeout(300)
        check("điện thoại: không tràn ngang ở bước 6", not await m.evaluate("document.documentElement.scrollWidth>document.documentElement.clientWidth+1"))
        await m.screenshot(path='/tmp/bp_m.png', full_page=False)
        await pg.click('nav [data-tab="fix"]'); await pg.wait_for_timeout(300); await pg.screenshot(path='/tmp/bp_full.png', full_page=True)
        check("không có lỗi JavaScript", not errs, errs)
        await b.close()
    print("\nTẤT CẢ ĐẠT" if ok else "\nCÓ LỖI"); sys.exit(0 if ok else 1)
asyncio.run(main())
