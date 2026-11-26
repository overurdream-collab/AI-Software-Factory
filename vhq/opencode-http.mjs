import {runPilot} from './opencode-pilot.mjs';
const origin='http://127.0.0.1:4096',directory='/home/zain/vhq-pilot';
const providerID='opencode';
export const defaultModel='deepseek-v4.1-flash-free';
const validModel=id=>typeof id==='string'&&/^[a-z0-9][a-z0-9._-]{0,100}-free$/.test(id);
const zero=c=>c?.input===0&&c?.output===0&&c?.cache?.read===0&&c?.cache?.write===0;
const freeModel=(id,m)=>validModel(id)&&m?.providerID===providerID&&m.id===id&&zero(m.cost)&&(!m.cost.tiers||Array.isArray(m.cost.tiers)&&m.cost.tiers.every(zero))&&(!m.cost.experimentalOver200K||zero(m.cost.experimentalOver200K));
export function modelChoices(catalog,kind='coding',observations={}){
 const models=catalog.providers?.find(p=>p.id===providerID)?.models||{};
 const preferred=kind==='coding'?['deepseek-v4.1-flash-free','mimo-v2.6-flash-free']:['mimo-v2.6-flash-free','deepseek-v4.1-flash-free'];
 const rows=Object.entries(models).filter(([id,m])=>freeModel(id,m)).map(([id])=>({id,provider:providerID,price:'zero-catalog',availability:observations[id]||'unverified'}));
 rows.sort((a,b)=>{const rank=x=>x.availability==='verified-response'?0:x.availability==='unverified'?1:2;const pref=x=>preferred.includes(x.id)?preferred.indexOf(x.id):99;return rank(a)-rank(b)||pref(a)-pref(b)||a.id.localeCompare(b.id);});
 return {models:rows,recommended:rows.find(x=>x.availability==='verified-response')?.id||null,recommendationBasis:'heuristic; quota not guaranteed'};
}
export async function listHttpModels({password=process.env.VHQ_OPENCODE_PASSWORD,fetchImpl=fetch,kind='coding',observations={}}={}){
 if(!password)throw Error('http-auth-missing');
 const url=new URL('/config/providers',origin);url.searchParams.set('directory',directory);
 const response=await fetchImpl(url,{headers:{Authorization:'Basic '+Buffer.from('opencode:'+password).toString('base64')},redirect:'error',signal:AbortSignal.timeout(15000)});
 if(!response.ok)throw Error('http-status-'+response.status);
 const raw=await response.text();if(Buffer.byteLength(raw)>4*1024*1024)throw Error('http-response-limit');
 return modelChoices(JSON.parse(raw),kind,observations);
}
const deny=[{permission:'*',pattern:'*',action:'deny'}];
const prompt='Write one JavaScript line exporting a function named add with parameters a and b that returns their numeric sum. No explanation. Do not use tools or access files.';
export async function runHttpPilot({password=process.env.VHQ_OPENCODE_PASSWORD,fetchImpl=fetch,onStage=()=>{},modelID=defaultModel,probe=false}={}){
 if(typeof password!=='string'||!password)throw Error('http-auth-missing');
 const headers={Authorization:'Basic '+Buffer.from('opencode:'+password).toString('base64'),'Content-Type':'application/json'};
 async function call(path,body,ms=15000,scoped=true){
  const url=new URL(path,origin);if(scoped)url.searchParams.set('directory',directory);
  const response=await fetchImpl(url,{headers,method:body===undefined?'GET':'POST',body:body===undefined?undefined:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(ms)});
  if(!response.ok)throw Error('http-status-'+response.status);
  const raw=await response.text();if(Buffer.byteLength(raw)>4*1024*1024)throw Error('http-response-limit');
  return JSON.parse(raw);
 }
 const health=await call('/global/health',undefined,10000,false);
 if(health.healthy!==true||health.version!=='1.19.5')throw Error('http-health-version');
 onStage('health-ok');
 const catalog=await call('/config/providers');
 const m=catalog.providers?.find(p=>p.id===providerID)?.models?.[modelID];
 if(!freeModel(modelID,m))throw Error('http-price-not-zero');
 const ids=await call('/experimental/tool/ids');
 if(!Array.isArray(ids)||!ids.length||!ids.every(x=>typeof x==='string'&&x.length<=200&&!['__proto__','constructor','prototype'].includes(x)))throw Error('http-tool-catalog');
 onStage('price-and-tools-ok');
 const session=await call('/session',{title:'VHQ synthetic addition pilot',model:{id:modelID,providerID},permission:deny});
 if(!/^ses[a-zA-Z0-9_-]+$/.test(session.id)||session.directory!==directory||JSON.stringify(session.permission)!==JSON.stringify(deny))throw Error('http-session-policy');
 const path='/session/'+session.id;
 onStage('session-created '+session.id);
 try{
  const message=await call(path+'/message',{model:{providerID,modelID},tools:Object.fromEntries(ids.map(id=>[id,false])),parts:[{type:'text',text:probe?'Reply only with VHQ_READY. Do not use tools or access files.':prompt}]},probe?20000:90000);
  if(message.info?.error){const err=JSON.stringify(message.info.error);if(/quota|insufficient.credit|free.*limit|usage.limit|billing|rate.limit|429/i.test(err))throw Error('http-quota-or-rate-limit');throw Error('http-provider-error');}
  if(message.info?.sessionID!==session.id||message.info?.role!=='assistant'||message.info?.providerID!==providerID||message.info?.modelID!==modelID||message.info?.cost!==0||message.info?.error||!message.info?.time?.completed||!Array.isArray(message.parts))throw Error('http-message-unverified');
  if(message.parts.some(p=>p.type==='tool'))throw Error('unexpected tool use');
  if(probe){if(message.parts.filter(p=>p.type==='text').map(p=>p.text).join('').trim()!=='VHQ_READY')throw Error('http-probe-unverified');return {model:providerID+'/'+modelID,sessionId:session.id,reportedCost:0,checkedAt:Date.now()};}
  const evidence=await runPilot(async()=>message.parts.filter(p=>p.type==='text').map(p=>JSON.stringify({type:'text',part:{text:p.text}})).join('\n'));
  return {...evidence,model:providerID+'/'+modelID,transport:'http',sessionId:session.id,reportedCost:0};
 }catch(e){
  try{await call(path+'/abort',{},5000);}catch{}
  throw e;
 }
}
