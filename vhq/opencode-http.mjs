import {runPilot} from './opencode-pilot.mjs';
const origin='http://127.0.0.1:4096',directory='/home/zain/vhq-pilot';
const providerID='opencode',modelID='deepseek-v4.1-flash-free';
const deny=[{permission:'*',pattern:'*',action:'deny'}];
const prompt='Write one JavaScript line exporting a function named add with parameters a and b that returns their numeric sum. No explanation. Do not use tools or access files.';
export async function runHttpPilot({password=process.env.VHQ_OPENCODE_PASSWORD,fetchImpl=fetch,onStage=()=>{}}={}){
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
 const zero=c=>c?.input===0&&c?.output===0&&c?.cache?.read===0&&c?.cache?.write===0;
 if(!m||m.providerID!==providerID||m.id!==modelID||!zero(m.cost)||m.cost.tiers?.some(t=>!zero(t))||(m.cost.experimentalOver200K&&!zero(m.cost.experimentalOver200K)))throw Error('http-price-not-zero');
 const ids=await call('/experimental/tool/ids');
 if(!Array.isArray(ids)||!ids.length||!ids.every(x=>typeof x==='string'&&x.length<=200&&!['__proto__','constructor','prototype'].includes(x)))throw Error('http-tool-catalog');
 onStage('price-and-tools-ok');
 const session=await call('/session',{title:'VHQ synthetic addition pilot',model:{id:modelID,providerID},permission:deny});
 if(!/^ses[a-zA-Z0-9_-]+$/.test(session.id)||session.directory!==directory||JSON.stringify(session.permission)!==JSON.stringify(deny))throw Error('http-session-policy');
 const path='/session/'+session.id;
 onStage('session-created '+session.id);
 try{
  const message=await call(path+'/message',{model:{providerID,modelID},tools:Object.fromEntries(ids.map(id=>[id,false])),parts:[{type:'text',text:prompt}]},90000);
  if(message.info?.sessionID!==session.id||message.info?.role!=='assistant'||message.info?.providerID!==providerID||message.info?.modelID!==modelID||message.info?.cost!==0||message.info?.error||!message.info?.time?.completed||!Array.isArray(message.parts))throw Error('http-message-unverified');
  if(message.parts.some(p=>p.type==='tool'))throw Error('unexpected tool use');
  const evidence=await runPilot(async()=>message.parts.filter(p=>p.type==='text').map(p=>JSON.stringify({type:'text',part:{text:p.text}})).join('\n'));
  return {...evidence,transport:'http',sessionId:session.id,reportedCost:0};
 }catch(e){
  try{await call(path+'/abort',{},10000);}catch{}
  throw e;
 }
}
