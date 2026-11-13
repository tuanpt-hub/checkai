import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const html=fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
const pool=html.slice(html.indexOf('async function pool('),html.indexOf('function selEngines('));
const run=html.slice(html.indexOf('async function runProbe('),html.indexOf('function engineStats('));
async function scenario(code,late=false) {
 const calls={Claude:0,Gemini:0},a={probe:{}};
 const context={
  chosenModels:()=>({judge:'judge-test'}),A:()=>a,busy:null,stopFlag:false,flash:{},
  promptList:()=>Array.from({length:41},(_,i)=>({id:'B'+i,g:'B',q:'Test?'})),
  selEngines:()=>['Claude','Gemini'],runCfg:{reps:1,web:true},
  ENGMAP:{Claude:'Claude',Gemini:'Gemini'},newCtl:()=>undefined,
  render:()=>{},progress:()=>{},noteUsage:()=>{},mentioned:()=>false,
  askJSON:async()=>[],judgePrompt:()=>'',clamp:(_,lo,hi,d)=>d,touch:()=>{},tab:'probe',me:{},
  api:async(path,opts)=>{
   if(path==='/api/me')return {};
   const e=opts.body.engine;calls[e]++;
   if(e==='Claude'&&(!late||calls[e]>1))throw {code,message:'Test upstream failure'};
   return {text:'Successful answer',model:e+'-test',sources:[],queries:[]};
  },
 };
 vm.createContext(context);await vm.runInContext(pool+run+';runProbe(["B"])',context);
 assert.equal(calls.Gemini,41,'healthy engine completes all planned questions');
 assert.equal(Object.keys(a.probe).filter(id=>a.probe[id].Gemini).length,41);
 assert.match(context.flash.probe,/Claude:/);
 return {calls,context};
}
for(const code of ['bad_request','invalid_api_response','provider_error']) {
 const {calls,context}=await scenario(code);
 assert.equal(calls.Claude,1,'failed first question must not fan out to 41 requests');
 assert.match(context.flash.probe,/Đã dừng/);
}
const {calls}=await scenario('provider_error',true);
assert.ok(calls.Claude<=6,'stop after repeated failures following successful first question');
console.log('Probe preflight: single failed first call, healthy engine completes 41, successes saved, later failures halt passed.');
