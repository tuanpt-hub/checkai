import assert from 'node:assert/strict';
import {claudeThinking} from '../api/_lib/claude-output.js';
import {askClaude} from '../api/_lib/providers.js';
assert.equal(claudeThinking('anthropic/claude-sonnet-5.5').thinking.type,'between_tools');
assert.equal(claudeThinking('claude-sonnet-5-5').output_config.effort,'low');
assert.equal(claudeThinking('anthropic/claude-haiku-5.5').thinking.type,'disabled');
assert.equal(claudeThinking('anthropic/claude-haiku-5.5',true).thinking.type,'adaptive');
assert.equal(claudeThinking('anthropic/claude-sonnet-5.5',true).thinking.type,'adaptive');
assert.deepEqual(claudeThinking('anthropic/claude-haiku-4.5'),{});
process.env.AI_GATEWAY_API_KEY='test-key';
const oldFetch=globalThis.fetch,oldLog=console.error;const logs=[];console.error=(...a)=>logs.push(a.join(' '));
try {
 for(const model of ['anthropic/claude-sonnet-5.5','anthropic/claude-haiku-5.5']) {
  let count=0;
  globalThis.fetch=async(_,init)=>{
   count++;const b=JSON.parse(init.body);assert.equal(b.max_tokens,1500,'do not increase spend cap');
   const required=model.includes('sonnet')?'between_tools':'disabled';
   // Reproduce a provider that spends the entire cap thinking when not configured.
   if(b.thinking?.type!==required)return Response.json({content:[{type:'thinking',thinking:'',signature:'private-signature'}],stop_reason:'max_tokens',usage:{output_tokens:1500}});
   return Response.json({content:[{type:'text',text:'[]'}],stop_reason:'end_turn',usage:{output_tokens:2}});
  };
  assert.equal((await askClaude({prompt:'private prompt',model})).text,'[]');assert.equal(count,1);
 }
 for(const [content,reason,code] of [
  [[{type:'thinking',thinking:'secret thinking',signature:'private-signature'}],'max_tokens','output_limit'],
  [[], 'end_turn','empty_response'],
  [null,'end_turn','invalid_provider_response'],
 ]) {
  let count=0;globalThis.fetch=async()=>{count++;return Response.json({content,stop_reason:reason,usage:{output_tokens:1500}});};
  await assert.rejects(askClaude({prompt:'private prompt',model:'anthropic/claude-sonnet-5.5'}),e=>e.code===code&&e.extra.stopReason===reason);
  assert.equal(count,1,'no hidden paid retry');
 }
 assert.ok(logs.every(l=>!l.includes('secret thinking')&&!l.includes('private-signature')&&!l.includes('private prompt')));
} finally{globalThis.fetch=oldFetch;console.error=oldLog;}
console.log('Claude output: 5.5 thinking modes, thinking-only reproduction, same cap, no retry, typed errors and safe metadata passed.');
