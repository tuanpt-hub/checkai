import asyncio
from playwright.async_api import async_playwright
BASE="http://localhost:3100"
async def login(pg):
    await pg.goto(BASE); await pg.wait_for_selector('#login:not([hidden]),#app:not([hidden])')
    if await pg.evaluate("!document.querySelector('#login').hidden"):
        await pg.fill('#lgEmail','staff@netspace.vn'); await pg.fill('#lgPass','Mat-khau-1'); await pg.click('#lgBtn')
    await pg.wait_for_selector('#app:not([hidden])'); await pg.wait_for_timeout(700)
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(); errs=[]
        # --- two people editing the same audit -> conflict
        c1=await b.new_context(viewport={"width":1200,"height":900}); c2=await b.new_context(viewport={"width":1200,"height":900})
        p1=await c1.new_page(); p2=await c2.new_page()
        for pg in (p1,p2): pg.on('pageerror',lambda e:errs.append(str(e)))
        await login(p1)
        await p1.click('[data-act="seed"]'); await p1.wait_for_function("document.querySelector('#saveState').textContent==='Đã lưu'",timeout=8000)
        await login(p2); await p2.wait_for_timeout(500)
        print('A p2 sees audit:',await p2.evaluate("audits[cur]&&audits[cur].profile.brand"))
        await p1.click('nav [data-tab="profile"]'); await p2.click('nav [data-tab="profile"]'); await p1.fill('#f_website','https://p1.example'); await p1.wait_for_function("document.querySelector('#saveState').textContent==='Đã lưu'",timeout=8000)
        await p2.fill('#f_website','https://p2.example'); await p2.wait_for_timeout(2500)
        print('B p2 status:',await p2.inner_text('#saveState'),'| banner:',(await p2.inner_text('.warnbox'))[:80].replace('\n',' '))
        await p2.screenshot(path='/tmp/ui_conflict.png')
        await p2.click('[data-act="overwrite"]'); await p2.wait_for_function("document.querySelector('#saveState').textContent==='Đã lưu'",timeout=8000)
        print('C overwritten, banner gone:',await p2.evaluate("!document.querySelector('.warnbox')"))
                # --- session cookie removed mid-use -> login overlay, work not lost, saved after re-login
        await p1.reload(); await p1.wait_for_selector('#app:not([hidden])'); await p1.wait_for_timeout(600)
        await c1.clear_cookies()
        await p1.fill('#f_legal','Tên pháp lý mới sau khi hết phiên'); await p1.wait_for_selector('#login:not([hidden])',timeout=9000)
        print('D session expired -> login shown:',await p1.inner_text('#loginErr'))
        await p1.fill('#lgEmail','staff@netspace.vn'); await p1.fill('#lgPass','Mat-khau-1'); await p1.click('#lgBtn'); await p1.wait_for_selector('#app:not([hidden])')
        await p1.wait_for_function("document.querySelector('#saveState').textContent==='Đã lưu'",timeout=10000)
        print('E value kept after relogin:',await p1.input_value('#f_legal'))
        # --- result screens
        await p1.click('nav [data-tab="result"]'); await p1.wait_for_timeout(400); await p1.screenshot(path='/tmp/ui_result2.png')
        await p1.click('nav [data-tab="probe"]'); await p1.wait_for_timeout(300); await p1.screenshot(path='/tmp/ui_probe_d.png')
        print('ERRORS',errs)
        await b.close()
asyncio.run(main())
