import assert from 'node:assert/strict';
import {judgeOrWrite,judgeCandidates} from '../api/_lib/judge.js';
import {HttpError} from '../api/_lib/util.js';
process.env.AI_GATEWAY_API_KEY='test-fallback';
const base={email:'staff@example.test',model:'anthropic/claude-sonnet-5.5',prompt:'Test judge',maxTokens:2000};
assert.deepEqual(judgeCandidates(base.model).map(x=>x.id),[base.model,'openai/gpt-6-luna','google/gemini-3.1-flash-lite']);
for(const failure of ['empty_response','timeout','rate_limited','model_not_found','output_limit']){
 const seen=[];let charges=0;
 const r=await judgeOrWrite({...base,json:true},{bump:async()=>({used:++charges,limit:10}),ask:async(engine,o)=>{
  seen.push(o.model);assert.equal(o.web,false);assert.equal(o.maxTokens,2000);assert.equal(o.maxRetries,0);assert.equal(o.retries,0);
  if(engine==='claude')throw new HttpError(502,failure,'fail');
  return {text:'[{"id":"B1","code":2}]',model:o.model};
 }});
 assert.equal(charges,2);assert.equal(r.model,'openai/gpt-6-luna');assert.equal(r.fallbackUsed,true);assert.equal(r.json[0].id,'B1');assert.equal(r.attempts[0].code,failure);
}
let calls=0,charges=0;
const r=await judgeOrWrite(base,{bump:async()=>({used:++charges}),ask:async(_,o)=>{
 calls++;return {model:o.model,text:calls===1?'':'Văn bản hoàn chỉnh'};
}});assert.equal(r.text,'Văn bản hoàn chỉnh');assert.equal(calls,2);
const json=await judgeOrWrite({...base,json:true},{bump:async()=>({}),ask:async(_,o)=>({text:o.model===base.model?'not JSON':'{}',model:o.model})});assert.equal(json.fallbackUsed,true);
let attempted=0;
await assert.rejects(judgeOrWrite(base,{bump:async()=>({}),ask:async()=>{attempted++;throw new HttpError(502,'provider_error');}}),e=>e.code==='all_models_failed'&&e.extra.attempts.length===3);assert.equal(attempted,3);
for(const code of ['daily_limit','usage_unavailable','insufficient_credit','unauthorized']) {
 let count=0;
 await assert.rejects(judgeOrWrite(base,{bump:async()=>({}),ask:async()=>{count++;throw new HttpError(429,code);}}),e=>e.code===code);assert.equal(count,1);
}
let callsAfterQuota=0;
await assert.rejects(judgeOrWrite(base,{bump:async()=>{throw new HttpError(429,'daily_limit');},ask:async()=>{callsAfterQuota++;}}),e=>e.code==='daily_limit');assert.equal(callsAfterQuota,0);
await assert.rejects(judgeOrWrite(base,{isCancelled:()=>true,bump:async()=>{throw Error('must not charge');}}),e=>e.code==='cancelled');
// Direct keys: no Claude key; OpenAI remains available for all judge/writer functions.
delete process.env.AI_GATEWAY_API_KEY;delete process.env.ANTHROPIC_API_KEY;delete process.env.GEMINI_API_KEY;process.env.OPENAI_API_KEY='direct-test';
assert.equal(judgeCandidates('claude-sonnet-5-5')[0].engine,'openai');
console.log('Judge/writer fallback: order, JSON/text, actual model, all failures, quota per attempt, stop conditions, cancellation and direct keys passed.');
