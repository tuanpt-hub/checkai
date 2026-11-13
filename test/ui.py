import asyncio,sys
from playwright.async_api import async_playwright
BASE="http://localhost:3100"
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(); ctx=await b.new_context(viewport={"width":1200,"height":900}); pg=await ctx.new_page(); errs=[]
        pg.on('pageerror',lambda e:errs.append('PAGEERR '+str(e))); pg.on('console',lambda m: m.type=='error' and 'Failed to load resource' not in m.text and errs.append('CONSOLE '+m.text))
        await pg.goto(BASE); await pg.wait_for_selector('#login:not([hidden])'); await pg.screenshot(path='/tmp/ui_login.png')
        print('1 login screen shown, app hidden:',await pg.evaluate("document.querySelector('#app').hidden"))
        # wrong password
        await pg.fill('#lgEmail','staff@netspace.vn'); await pg.fill('#lgPass','sai'); await pg.click('#lgBtn'); await pg.wait_for_timeout(600)
        print('2 wrong pw message:',await pg.inner_text('#loginErr'))
        await pg.fill('#lgPass','Mat-khau-1'); await pg.click('#lgBtn'); await pg.wait_for_selector('#app:not([hidden])')
        print('3 logged in as:',await pg.inner_text('#userChip'))
        # empty state -> load seed
        await pg.click('[data-act="seed"]'); await pg.wait_for_timeout(1800)
        print('4 saved status:',await pg.inner_text('#saveState'),'| audits in select:',await pg.evaluate("[...document.querySelectorAll('#auditSel option')].map(o=>o.textContent)"))
        # probe tab: run group B on 3 engines
        await pg.click('nav [data-tab="probe"]'); await pg.wait_for_timeout(300)
        await pg.screenshot(path='/tmp/ui_probe0.png')
        print('5 run buttons:',await pg.evaluate("[...document.querySelectorAll('[data-act=run]')].map(b=>b.textContent.trim())"))
        await pg.click('[data-act="run"][data-g="B"]'); await pg.wait_for_selector('.okbox',timeout=30000); await pg.wait_for_timeout(300)
        print('6 result msg:',await pg.inner_text('.okbox'))
        print('7 engine table rows:',await pg.evaluate("[...document.querySelectorAll('table:not(.ptable) tbody tr')].map(r=>r.innerText.replace(/\\s+/g,' '))"))
        # details with sources
        await pg.evaluate("document.querySelector('.ptable details').open=true")
        print('8 first details:',(await pg.inner_text('.ptable details'))[:400].replace('\n',' | '))
        await pg.screenshot(path='/tmp/ui_probe1.png',full_page=False)
        # run all with 2 reps for just Gemini+Claude to test aggregation: uncheck ChatGPT, reps=2
        await pg.uncheck('[data-eng="ChatGPT"]'); await pg.select_option('#cfgReps','2'); await pg.wait_for_timeout(200)
        print('9 button label after changing cfg:',await pg.inner_text('[data-act=run][data-g=B]'))
        await pg.click('[data-act="run"][data-g="B"]'); await pg.wait_for_selector('.okbox',timeout=30000)
        print('10 msg2:',await pg.inner_text('.okbox'))
        runs=await pg.evaluate("(()=>{const a=audits[cur];return a.probe.B1&&Object.entries(a.probe.B1).map(([e,r])=>e+':'+JSON.stringify(r.runs)+':'+r.model+':src'+r.sources.length)})()"); print('11 B1 records:',runs)
        # reload page -> persisted on server, session cookie keeps login
        await pg.wait_for_function("document.querySelector('#saveState').textContent==='Đã lưu'",timeout=10000)
        await pg.reload(); await pg.wait_for_selector('#app:not([hidden])'); await pg.wait_for_timeout(800)
        print('12 after reload brand:',await pg.evaluate("audits[cur]&&audits[cur].profile.brand"),'| probe B1 engines:',await pg.evaluate("Object.keys((audits[cur].probe.B1)||{})"))
        # result tab, report
        await pg.click('nav [data-tab="result"]'); await pg.wait_for_timeout(300); await pg.screenshot(path='/tmp/ui_result.png',full_page=True)
        await pg.click('[data-act="showmd"]'); md=await pg.inner_text('#mdBox'); print('13 report has engine table:', 'Theo từng AI' in md, '| models line:', [l for l in md.split('\n') if l.startswith('Cấu hình đo')])
        # summary generation via claude
        await pg.click('[data-act="summary"]'); await pg.wait_for_timeout(1200); print('14 summary text:',(await pg.inner_text('[data-out=summary]'))[:60])
        # logout
        await pg.click('#logoutBtn'); await pg.wait_for_selector('#login:not([hidden])'); print('15 logged out, app hidden:',await pg.evaluate("document.querySelector('#app').hidden"))
        # API now 401 from page context
        st=await pg.evaluate("fetch('/api/me',{headers:{'X-ABR':'1'}}).then(r=>r.status)"); print('16 /api/me after logout:',st)
        print('ERRORS:',errs)
        # mobile screenshot of login + probe
        m=await b.new_page(viewport={"width":380,"height":800}); await m.goto(BASE); await m.wait_for_selector('#login:not([hidden])'); await m.screenshot(path='/tmp/ui_login_m.png')
        await m.fill('#lgEmail','staff@netspace.vn'); await m.fill('#lgPass','Mat-khau-1'); await m.click('#lgBtn'); await m.wait_for_selector('#app:not([hidden])'); await m.wait_for_timeout(800)
        await m.click('nav [data-tab="probe"]'); await m.wait_for_timeout(400); await m.screenshot(path='/tmp/ui_probe_m.png',full_page=False)
        await b.close()
asyncio.run(main())
