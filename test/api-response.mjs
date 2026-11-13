import assert from 'node:assert/strict';
import '../public/api-response.js';
const read=CheckAIResponse.read;
for(const [body,headers] of [
 ['<html>Bad Gateway Authorization: secret</html>',{'content-type':'text/html'}],
 ['Bad Gateway',{'content-type':'text/plain'}],
 [JSON.stringify({error:'Bad Gateway'}),{'content-type':'application/json'}],
 ['',{}],
]) {
 await assert.rejects(read(new Response(body,{status:502,headers:{...headers,'x-vercel-id':'sin1::req123'}})),e=>e.code==='invalid_api_response'&&e.status===502&&e.message.includes('sin1::req123')&&!e.message.includes('secret'));
}
await assert.rejects(read(new Response('failure',{status:502,headers:{'x-vercel-error':'FUNCTION_INVOCATION_FAILED'}})),e=>e.message.includes('Hàm máy chủ bị lỗi'));
await assert.rejects(read(Response.json({error:{code:'bad_request',message:'Model rejected tool',generationId:'gen_test'}},{status:502})),e=>e.code==='bad_request'&&e.generationId==='gen_test');
await assert.rejects(read(new Response('<html>login</html>',{status:200})),e=>e.code==='invalid_api_response');
assert.deepEqual(await read(Response.json({ok:true})),{ok:true});
console.log('API response: HTML/text/alternate JSON 502, request ID, platform errors and structured errors passed.');
