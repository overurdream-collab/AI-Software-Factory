import {inspectProvider} from './provider-manager.mjs';
import {runPilot} from './opencode-pilot.mjs';
export async function runOpenRouterPilot(modelID,{env=process.env,fetchImpl=fetch}={}){
 if(typeof modelID!=='string'||!modelID.endsWith(':free'))throw Error('free-model-required');
 const status=await inspectProvider('openrouter',{env,fetchImpl});
 if(status.state!=='catalog-verified'||status.freeTier!==true||!status.models.includes(modelID))throw Error('free-account-or-model-unverified');
 const res=await fetchImpl('https://openrouter.ai/api/v1/chat/completions',{method:'POST',headers:{Authorization:'Bearer '+env.OPENROUTER_API_KEY,'Content-Type':'application/json'},redirect:'error',signal:AbortSignal.timeout(60000),body:JSON.stringify({model:modelID,messages:[{role:'user',content:'Return only one JavaScript line: export function add(a,b) that returns a+b. No explanation, no tools.'}],max_tokens:512,stream:false,provider:{allow_fallbacks:false,max_price:{prompt:0,completion:0,request:0,image:0,audio:0}},usage:{include:true}})});
 if(!res.ok)throw Error('router-http-'+res.status);
 const raw=await res.text();if(Buffer.byteLength(raw)>262144)throw Error('router-response-limit');
 const data=JSON.parse(raw);const choice=data.choices?.[0];const msg=choice?.message;
 if(data.error||data.model!==modelID||typeof data.id!=='string'||choice?.finish_reason!=='stop'||msg?.role!=='assistant'||typeof msg.content!=='string'||msg.tool_calls?.length||msg.function_call)throw Error('router-response-unverified');
 if(data.usage?.cost!==0)throw Error('router-cost-unverified');
 const evidence=await runPilot(async()=>JSON.stringify({type:'text',part:{text:msg.content}}));
 return {...evidence,model:modelID,provider:'openrouter',generationId:data.id,cost:0,checkedAt:Date.now()};
}
