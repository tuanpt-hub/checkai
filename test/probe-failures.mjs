import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const html=fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
const pool=html.slice(html.indexOf('async function pool('),html.indexOf('function selEngines('));
const run=html.slice(html.indexOf('async function runProbe('),html.indexOf('function engineStats('));
// mode: 'always' (Claude luôn lỗi) | 'late' (lượt đầu thành công, sau đó lỗi) | 'flaky' (chỉ lượt đầu lỗi 1 lần) | 'truncated' (Gemini bị cắt)
async function scenario(code,mode='always') {
 const calls={Claude:0,Gemini:0},a={probe:{}},other={probe:{}},touched=[];
 let current=a;
 const context={
  clearAiNotice:()=>{},chosenModels:()=>({judge:'judge-test'}),A:()=>current,busy:null,stopFlag:false,flash:{},
  promptList:()=>Array.from({length:41},(_,i)=>({id:'B'+i,g:'B',q:'Test?'})),
  selEngines:()=>['Claude','Gemini'],runCfg:{reps:1,web:true},
  ENGMAP:{Claude:'Claude',Gemini:'Gemini'},newCtl:()=>undefined,
  render:()=>{},progress:()=>{},noteUsage:()=>{},mentioned:()=>false,setTimeout:fn=>{fn();return 0},
  askJSON:async()=>[],judgePrompt:()=>'',clamp:(_,lo,hi,d)=>d,touch:x=>touched.push(x),tab:'probe',me:{},
  api:async(path,opts)=>{
   if(path==='/api/me')return {};
   const e=opts.body.engine;calls[e]++;
   if(calls.Claude+calls.Gemini===2)current=other; // người dùng đổi sang audit khác khi đang chạy
   const fail=e==='Claude'&&(mode==='always'||(mode==='late'&&calls[e]>1)||(mode==='flaky'&&calls[e]===1));
   if(fail)throw {code,message:'Test upstream failure'};
   return {text:'Successful answer',model:e+'-test',sources:[],queries:[],truncated:mode==='truncated'&&e==='Gemini'};
  },
 };
 vm.createContext(context);await vm.runInContext(pool+run+';runProbe(["B"])',context);
 assert.equal(calls.Gemini,41,'healthy engine completes all planned questions');
 assert.equal(Object.keys(a.probe).filter(id=>a.probe[id].Gemini).length,41,'results are written to the audit that started the run');
 assert.equal(Object.keys(other.probe).length,0,'results never leak into the audit the user switched to');
 assert.equal(touched.at(-1),a,'touch() must save the audit that owns the results, not the one currently open');
 return {calls,context,a};
}
// 1) Lỗi cấu hình: không gửi tiếp, không thử lại.
for(const code of ['bad_request','invalid_api_response']) {
 const {calls,context}=await scenario(code);
 assert.equal(calls.Claude,1,code+': failed first question must not fan out or retry');
 assert.match(context.flash.probe,/Claude:/);assert.match(context.flash.probe,/Đã dừng/);
}
// 2) Lỗi tạm thời kéo dài: thử lại đúng một lần rồi dừng AI đó.
for(const code of ['provider_error','timeout','empty_response','network','rate_limited']) {
 const {calls,context}=await scenario(code);
 assert.equal(calls.Claude,2,code+': one retry, then halt');
 assert.match(context.flash.probe,/Đã dừng/);
}
// 3) Lỗi tạm thời chỉ một lần: AI đó vẫn chạy hết 41 câu.
{
 const {calls,context,a}=await scenario('timeout','flaky');
 assert.equal(calls.Claude,42,'one failed attempt + 41 successful questions');
 assert.equal(Object.keys(a.probe).filter(id=>a.probe[id].Claude).length,41);
 assert.doesNotMatch(context.flash.probe||'',/Đã dừng/);
}
// 4) Thành công lượt đầu rồi lỗi liên tiếp: dừng sau vài câu.
{
 const {calls}=await scenario('provider_error','late');
 assert.ok(calls.Claude<=12,'stop after repeated failures following successful first question, got '+calls.Claude);
}
// 5) Câu trả lời bị cắt phải được đánh dấu và cảnh báo.
{
 const {context,a}=await scenario('provider_error','truncated');
 assert.equal(a.probe.B0.Gemini.truncated,true);
 assert.equal(a.probe.B0.Claude.truncated,false);
 assert.match(context.flash.probeOk,/bị cắt/);
}
console.log('Probe: preflight, transient retry, truncation flag and per-audit save passed.');
