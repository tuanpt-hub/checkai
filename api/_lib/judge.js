import { ask, MODELS } from './providers.js';
import { modelOptions } from './model-options.js';
import { gatewayEnabled } from './gateway.js';
import { bump } from './usage.js';
import { HttpError, extractJSON } from './util.js';

const recoverable = new Set(['empty_response','output_limit','invalid_json','invalid_provider_response','model_not_found','provider_error','provider_unavailable','bad_request','rate_limited','timeout','network','auth_failed','not_configured']);
export function judgeCandidates(primary) {
  const defaults=MODELS(),options=modelOptions(defaults).judge;
  const preferred=gatewayEnabled()
    ? ['openai/gpt-6-luna','google/gemini-3.1-flash-lite','anthropic/claude-haiku-5.5']
    : [defaults.openai,defaults.gemini,defaults.claude];
  const ids=[...new Set([primary,...preferred])];
  return ids.map(id=>options.find(o=>o.id===id)).filter(Boolean).slice(0,3);
}

export async function judgeOrWrite({email,model,prompt,json=false,maxTokens}, deps={}) {
  const {ask:call=ask,bump:charge=bump,now=Date.now,isCancelled=()=>false}=deps;
  const candidates=judgeCandidates(model),attempts=[],deadline=now()+100_000;
  if(!candidates.length)throw new HttpError(503,'not_configured','Chưa có model khả dụng để chấm hoặc soạn nội dung.');
  for(let i=0;i<candidates.length;i++) {
    if(isCancelled())throw new HttpError(499,'cancelled','Yêu cầu đã dừng.');
    const candidate=candidates[i],remaining=deadline-now();
    if(remaining<1000)break;
    // Count every paid attempt, including failed/empty generations, toward quota.
    const quota=await charge(email,1);
    try {
      const r=await call(candidate.engine,{prompt,web:false,model:candidate.id,maxTokens,retries:0,maxRetries:0,
        deadline:Math.min(deadline,now()+Math.floor(remaining/(candidates.length-i)))});
      if(!r.text?.trim())throw new HttpError(502,'empty_response','Model không trả văn bản.');
      if(r.truncated)throw new HttpError(502,'output_limit','Model chưa hoàn thành câu trả lời.');
      const parsed=json?extractJSON(r.text):undefined;
      if(json&&(parsed===null||typeof parsed!=='object'))throw new HttpError(502,'invalid_json','Model trả sai định dạng JSON.');
      attempts.push({model:candidate.id,engine:candidate.engine,ok:true});
      return {...(json?{json:parsed}:{text:r.text}),model:r.model||candidate.id,requestedModel:model,
        fallbackUsed:candidate.id!==model,attempts,...quota};
    } catch(e) {
      if(!(e instanceof HttpError)||!recoverable.has(e.code))throw e;
      attempts.push({model:candidate.id,engine:candidate.engine,ok:false,code:e.code});
    }
  }
  throw new HttpError(502,'all_models_failed','Các model chấm/soạn đều chưa hoàn tất được yêu cầu. '+attempts.map(a=>a.model+': '+a.code).join('; '),{attempts,requestedModel:model});
}
