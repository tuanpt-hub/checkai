import assert from 'node:assert/strict';
import { startFakes, USERS } from './fakes.js';
import { startServer } from '../scripts/dev.js';
const f=await startFakes();
Object.assign(process.env,{SUPABASE_URL:`http://127.0.0.1:${f.ports.supabase}`,SUPABASE_PUBLISHABLE_KEY:'sb_publishable_test',SUPABASE_SECRET_KEY:'sb_secret_test',ALLOWED_EMAIL_DOMAINS:'netspace.vn',AI_GATEWAY_API_KEY:'gateway-model-test',COOKIE_INSECURE:'1',DAILY_CALL_LIMIT:'100'});
const server=await startServer(0),base=`http://127.0.0.1:${server.address().port}`;
const nativeFetch=globalThis.fetch;let actualModel,calls=0;
globalThis.fetch=async(url,init)=>{
 if(String(url).startsWith('https://ai-gateway.vercel.sh/')) {
  calls++;actualModel=new Headers(init.headers).get('ai-language-model-id')||JSON.parse(init.body).model;
  if(String(url).endsWith('/v1/messages') && JSON.parse(init.body).messages[0].content==='Force truncated judge')return Response.json({content:[{type:'text',text:'['}],stop_reason:'max_tokens',usage:{output_tokens:2000}});
  if(String(url).endsWith('/v1/messages'))return Response.json({content:[{type:'text',text:'[]'}],stop_reason:'end_turn',usage:{input_tokens:1,output_tokens:1}});
  return new Response(JSON.stringify({content:[{type:'text',text:'[]'}],finishReason:{unified:'stop',raw:'stop'},usage:{inputTokens:{total:1},outputTokens:{total:1}},warnings:[]}),{headers:{'content-type':'application/json'}});
 }
 return nativeFetch(url,init);
};
try {
 const login=await fetch(base+'/api/login',{method:'POST',headers:{'content-type':'application/json','X-ABR':'1'},body:JSON.stringify({email:'staff@netspace.vn',password:USERS['staff@netspace.vn']})});
 const cookie=login.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');
 async function request(path,body){const r=await fetch(base+path,{method:body?'POST':'GET',headers:{Cookie:cookie,'X-ABR':'1','Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json()};}
 const me=await request('/api/me');assert.ok(me.data.gateway);assert.equal(me.data.modelOptions.openai[0].id,'openai/gpt-6-luna');
 const invalid=await request('/api/probe',{engine:'openai',prompt:'Test?',model:'google/gemini-3.1-flash-lite'});assert.equal(invalid.status,400);assert.equal(calls,0);assert.equal((await request('/api/me')).data.used,0);
 const probe=await request('/api/probe',{engine:'openai',prompt:'Test?',web:false,model:'openai/gpt-5-mini'});assert.equal(probe.status,200);assert.equal(actualModel,'openai/gpt-5-mini');assert.equal(probe.data.model,actualModel);
 const luna=await request('/api/probe',{engine:'openai',prompt:'Test Luna?',web:false,model:'openai/gpt-6-luna'});assert.equal(luna.status,200);assert.equal(actualModel,'openai/gpt-6-luna');
 const claude=await request('/api/probe',{engine:'claude',prompt:'Test Claude web?',web:true,model:'anthropic/claude-haiku-5.5'});assert.equal(claude.status,200);assert.equal(actualModel,'anthropic/claude-haiku-5.5');
 const judge=await request('/api/claude',{prompt:'Judge',json:true,model:'anthropic/claude-haiku-5.5'});assert.equal(judge.status,200);assert.equal(actualModel,'anthropic/claude-haiku-5.5');
 const truncated=await request('/api/claude',{prompt:'Force truncated judge',json:true,model:'anthropic/claude-sonnet-5.5'});assert.equal(truncated.status,502);assert.equal(truncated.data.error.code,'output_limit');
 assert.equal((await request('/api/claude',{prompt:'Judge',model:'openai/gpt-5-mini'})).status,400);
 console.log('Model API: authenticated catalog, validation before quota, selected probe and judge reach SDK transport passed.');
} finally {globalThis.fetch=nativeFetch;server.close();f.close();}
