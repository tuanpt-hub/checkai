import assert from 'node:assert/strict';
import { askClaude } from '../api/_lib/providers.js';
import { searchTools } from '../api/_lib/gateway.js';
import { searchLocation } from '../api/_lib/search-location.js';
process.env.AI_GATEWAY_API_KEY='test-claude-native-key';process.env.SEARCH_COUNTRY='VN';
delete process.env.ANTHROPIC_API_KEY;delete process.env.ANTHROPIC_SEARCH_COUNTRY;
assert.equal(searchLocation('claude').country,undefined);
assert.equal(searchLocation('openai').country,'VN');
assert.equal(searchTools('claude').web_search.args.userLocation.country,undefined);
const oldFetch=globalThis.fetch,oldLog=console.error;let calls=0;
const answer={content:[{type:'text',text:'NetSpace cung cấp dịch vụ truyền thông.',citations:[{url:'https://netspace.vn',title:'NetSpace'}]}],stop_reason:'end_turn',usage:{input_tokens:10,output_tokens:20}};
globalThis.fetch=async(url,init)=>{
 calls++;assert.equal(url,'https://ai-gateway.vercel.sh/v1/messages');
 assert.equal(init.headers['x-api-key'],'test-claude-native-key');
 const b=JSON.parse(init.body);assert.equal(b.model,'anthropic/claude-haiku-5.5');assert.equal(b.max_tokens,1500);
 const tool=b.tools[0];assert.equal(tool.type,'web_search_20250305');assert.equal(tool.user_location.country,undefined);assert.equal(tool.user_location.city,'Hanoi');
 if(calls===1)return Response.json({content:[{type:'text',text:'Để tôi tìm kiếm'},{type:'server_tool_use',id:'s1',name:'web_search',input:{query:'NetSpace'}},{type:'web_search_tool_result',tool_use_id:'s1',content:[{url:'https://netspace.vn',title:'NetSpace'}]}],stop_reason:'pause_turn',usage:{input_tokens:3,output_tokens:4}});
 assert.equal(b.messages.at(-1).role,'assistant');return Response.json(answer);
};
try {
 const result=await askClaude({prompt:'NetSpace?',web:true,model:'anthropic/claude-haiku-5.5',deadline:Date.now()+10000});
 assert.equal(calls,2);assert.equal(result.text,answer.content[0].text);assert.equal(result.sources[0].url,'https://netspace.vn');assert.equal(result.queries[0],'NetSpace');assert.equal(result.usage.in,13);assert.equal(result.searchLocation.country,undefined);
 globalThis.fetch=async(url,init)=>{const b=JSON.parse(init.body);assert.equal(b.tools,undefined);return Response.json({content:[{type:'text',text:'[]'}],stop_reason:'end_turn',usage:{}});};
 assert.equal((await askClaude({prompt:'Judge',web:false,model:'anthropic/claude-haiku-5.5'})).text,'[]');
 console.error=()=>{};
 globalThis.fetch=async()=>Response.json({error:{type:'invalid_request_error',message:'Unsupported country code'},generationId:'gen_native'},{status:400});
 await assert.rejects(askClaude({prompt:'test',web:true,model:'anthropic/claude-haiku-5.5'}),e=>e.code==='bad_request'&&e.extra.upstreamStatus===400&&e.extra.generationId==='gen_native');
 process.env.ANTHROPIC_SEARCH_COUNTRY='us';assert.equal(searchLocation('claude').country,'US');
} finally {globalThis.fetch=oldFetch;console.error=oldLog;delete process.env.ANTHROPIC_SEARCH_COUNTRY;}
console.log('Claude Messages: Gateway key only, native endpoint, independent country, web/continuation/citations/usage, judge and HTTP errors passed.');
