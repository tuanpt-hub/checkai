import { selectedModel } from './_lib/model-options.js';
import { route, ok, allowMethods, readJson, HttpError } from './_lib/util.js';
import { requireUser } from './_lib/auth.js';
import { MODELS } from './_lib/providers.js';
import { judgeOrWrite } from './_lib/judge.js';

/** Compatibility endpoint for all judging/writing; provider fallbacks never use web. */
export default route(async (req,res)=>{
  allowMethods(req,['POST']);
  const user=await requireUser(req,res),b=await readJson(req,300_000);
  const prompt=String(b.prompt||'');
  if(prompt.length<3||prompt.length>120_000)throw new HttpError(400,'bad_prompt','Nội dung quá ngắn hoặc quá dài.');
  const model=selectedModel('judge',b.model,MODELS());
  const maxTokens=Math.min(Math.max(parseInt(b.maxTokens,10)||2000,200),6000);
  ok(res,await judgeOrWrite({email:user.email,model,prompt,json:!!b.json,maxTokens},{isCancelled:()=>req.aborted||res.destroyed}));
});
