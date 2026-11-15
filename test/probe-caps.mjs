import assert from 'node:assert/strict';
import { startFakes, USERS } from './fakes.js';
import { startServer } from '../scripts/dev.js';
// Trần token đầu ra mỗi AI phải tới được nhà cung cấp: Claude 1500, OpenAI 4000, Gemini 4096 (có thể đổi bằng PROBE_MAX_TOKENS_<ENGINE>).
const f=await startFakes();
Object.assign(process.env,{SUPABASE_URL:`http://127.0.0.1:${f.ports.supabase}`,SUPABASE_PUBLISHABLE_KEY:'sb_publishable_test',SUPABASE_SECRET_KEY:'sb_secret_test',ALLOWED_EMAIL_DOMAINS:'netspace.vn',AI_GATEWAY_API_KEY:'gateway-caps-test',COOKIE_INSECURE:'1',DAILY_CALL_LIMIT:'100'});
const server=await startServer(0),base=`http://127.0.0.1:${server.address().port}`;
const nativeFetch=globalThis.fetch,seen={};
globalThis.fetch=async(url,init)=>{
 if(String(url).startsWith('https://ai-gateway.vercel.sh/')) {
  const body=JSON.parse(init.body),id=new Headers(init.headers).get('ai-language-model-id')||body.model;
  if(String(url).endsWith('/v1/messages')){seen.claude=body.max_tokens;return Response.json({content:[{type:'text',text:'ok'}],stop_reason:'end_turn',usage:{input_tokens:1,output_tokens:1}});}
  seen[String(id).split('/')[0]]=body.maxOutputTokens;
  return new Response(JSON.stringify({content:[{type:'text',text:'ok'}],finishReason:{unified:'stop',raw:'stop'},usage:{inputTokens:{total:1},outputTokens:{total:1}},warnings:[]}),{headers:{'content-type':'application/json'}});
 }
 return nativeFetch(url,init);
};
try {
 const login=await fetch(base+'/api/login',{method:'POST',headers:{'content-type':'application/json','X-ABR':'1'},body:JSON.stringify({email:'staff@netspace.vn',password:USERS['staff@netspace.vn']})});
 const cookie=login.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');
 const probe=async(engine,model)=>{const r=await fetch(base+'/api/probe',{method:'POST',headers:{Cookie:cookie,'X-ABR':'1','Content-Type':'application/json'},body:JSON.stringify({engine,prompt:'Test cap?',web:false,model})});assert.equal(r.status,200,engine+' '+await r.clone().text());};
 await probe('claude','anthropic/claude-haiku-5.5');await probe('openai','openai/gpt-5-mini');await probe('gemini','google/gemini-3.6-flash');
 assert.equal(seen.claude,1500,'Claude cap unchanged');
 assert.equal(seen.openai,4000,'OpenAI cap must leave room for reasoning tokens');
 assert.equal(seen.google,4096,'Gemini cap must leave room for thinking tokens');
 process.env.PROBE_MAX_TOKENS_OPENAI='2500';await probe('openai','openai/gpt-5-mini');assert.equal(seen.openai,2500,'env override');
 console.log('Probe token caps: per-engine defaults and env override passed.');
} finally {globalThis.fetch=nativeFetch;server.close();f.close();}
