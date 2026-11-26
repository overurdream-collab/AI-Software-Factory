import {getDeepSeekBalance} from './deepseek-direct.mjs';
const specs={
 openrouter:{key:'OPENROUTER_API_KEY',url:'https://openrouter.ai/api/v1/key',name:'OpenRouter'},
 groq:{key:'GROQ_API_KEY',url:'https://api.groq.com/openai/v1/models',name:'Groq'},
 gemini:{key:'GEMINI_API_KEY',url:'https://generativelanguage.googleapis.com/v1beta/models',name:'Gemini'},
 cerebras:{key:'CEREBRAS_API_KEY',url:'https://api.cerebras.ai/v1/models',name:'Cerebras'}
};
async function get(url,headers,fetchImpl){
 const res=await fetchImpl(url,{headers,redirect:'error',signal:AbortSignal.timeout(12000)});
 if(!res.ok)throw Error('provider-http-'+res.status);
 const body=await res.text();if(Buffer.byteLength(body)>4000000)throw Error('invalid-response');
 return JSON.parse(body);
}
const zero=x=>typeof x==='string'&&/^0+(?:\.0+)?$/.test(x);
export function freeRouterModels(data){
 if(!Array.isArray(data?.data))throw Error('invalid-response');
 return data.data.filter(m=>typeof m.id==='string'&&/^[a-zA-Z0-9_.\/-]+:free$/.test(m.id)&&zero(m.pricing?.prompt)&&zero(m.pricing?.completion)&&Object.values(m.pricing).every(zero)).map(m=>m.id).slice(0,100);
}
export async function inspectProvider(id,{env=process.env,fetchImpl=fetch}={}){
 const spec=specs[id];if(!spec)throw Error('unknown-provider');
 const base={id,name:spec.name,generationEnabled:false,quotaVerified:false};
 const key=env[spec.key];if(!key)return {...base,state:'key-missing'};
 try{
 const headers=id==='gemini'?{'x-goog-api-key':key}:{Authorization:'Bearer '+key};
 const data=await get(spec.url,headers,fetchImpl);
 if(id==='openrouter'){
  if(typeof data?.data?.is_free_tier!=='boolean')throw Error('invalid-response');
  const models=freeRouterModels(await get('https://openrouter.ai/api/v1/models',headers,fetchImpl));
  return {...base,state:'catalog-verified',freeTier:data.data.is_free_tier,models,limitRemaining:typeof data.data.limit_remaining==='number'?data.data.limit_remaining:null};
 }
 const rows=id==='gemini'?data.models:data.data;if(!Array.isArray(rows))throw Error('invalid-response');
 return {...base,state:'catalog-verified',models:rows.map(m=>id==='gemini'?m.name:m.id).filter(x=>typeof x==='string').slice(0,100),planVerified:false};
 }catch(e){return {...base,state:e.message==='provider-http-429'?'rate-limited':e.message==='provider-http-401'?'auth-failed':e.message==='provider-http-403'?'access-denied':e.name==='TimeoutError'?'timeout':'unavailable'};}
}
export async function inspectProviders(options={}){
 return Promise.all(Object.keys(specs).map(id=>inspectProvider(id,options)));
}
export function recommendInspection(rows){
 return ['openrouter','groq','gemini','cerebras'].find(id=>rows.some(r=>r.id===id&&r.state==='catalog-verified'&&r.models?.length))??null;
}
// Catalog and authentication checks only. They do not prove free inference quota.
