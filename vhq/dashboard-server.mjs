import {createServer} from 'node:http';
import {readFileSync} from 'node:fs';
import {timingSafeEqual} from 'node:crypto';
import {runPilot} from './opencode-pilot.mjs';
import {prepareInteraction} from './interaction.mjs';
const html=readFileSync(new URL('./dashboard.html',import.meta.url));
export function createDashboard({registry,repository,token,expiresAt,clock=Date.now,pilotEnabled=false,pilotRunner=runPilot,modelLister=null,probeModel=null}){
 if(typeof token!=='string'||token.length<32||!Number.isSafeInteger(expiresAt))throw Error('operator token and expiry required');
 const authorized=req=>{const a=Buffer.from(req.headers.authorization||'');const b=Buffer.from('Bearer '+token);return a.length===b.length&&timingSafeEqual(a,b)&&clock()<expiresAt;};
 const grant=action=>({action,repository,expiresAt});
 return createServer(async(req,res)=>{
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'");
  const send=(code,data)=>{res.writeHead(code,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(data));};
  try{
   if(req.method==='GET'&&req.url==='/'){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});return res.end(html);}
   if(req.method==='GET'&&['/dashboard.js','/dashboard.css'].includes(req.url)){res.writeHead(200,{'Content-Type':req.url.endsWith('.js')?'text/javascript; charset=utf-8':'text/css; charset=utf-8'});return res.end(readFileSync(new URL('.'+req.url,import.meta.url)));}
   if(!authorized(req))return send(401,{error:'unauthorized'});
   if(req.method==='GET'&&req.url==='/api/status')return send(200,{repository,additionalBudget:0,providers:pilotEnabled?'opencode-pilot-enabled':'not-connected',assignments:registry.list({grant:grant('read'),repository,now:clock()}).map(a=>({...a,pilot:registry.pilotStatus(a.id)}))});
   if(req.method==='GET'&&req.url.startsWith('/api/models?')){
    if(!modelLister)return send(503,{error:'catalog unavailable'});
    const kind=new URL(req.url,'http://localhost').searchParams.get('kind');
    if(!['coding','analysis','review'].includes(kind))return send(400,{error:'invalid kind'});
    try{return send(200,await modelLister(kind));}catch(e){return send(503,{error:/^http-(auth-missing|status-[0-9]{3}|response-limit)$/.test(e.message)?e.message:e.name==='TimeoutError'?'catalog-timeout':'catalog-unreachable'});}
   }
   if(req.method==='POST'&&req.url==='/api/model-probe'){
    if(!pilotEnabled||!probeModel||!modelLister)return send(403,{error:'probe disabled'});
    if(req.headers['content-type']!=='application/json')return send(415,{error:'json required'});
    let n=0,parts=[];for await(const c of req){n+=c.length;if(n>2048)return send(413,{error:'too large'});parts.push(c);}
    const b=JSON.parse(Buffer.concat(parts).toString());
    if(b?.confirm!=='single-free-probe'||typeof b.modelID!=='string')return send(400,{error:'confirm probe'});
    const catalog=await modelLister('coding');
    if(!catalog.models.some(m=>m.id===b.modelID))return send(409,{error:'model not free'});
    try{return send(200,await probeModel(b.modelID));}catch{return send(409,{error:'probe busy'});}
   }
   if(req.method==='POST'&&req.url==='/api/pilot'){
    if(!pilotEnabled)return send(403,{error:'pilot disabled'});
    if(req.headers['content-type']!=='application/json')return send(415,{error:'json required'});
    let n=0,parts=[];for await(const c of req){n+=c.length;if(n>2048)return send(413,{error:'too large'});parts.push(c);}
    const b=JSON.parse(Buffer.concat(parts).toString());
    if(typeof b?.id!=='string'||b.confirm!=='synthetic-addition-only')return send(400,{error:'explicit pilot confirmation required'});
    if(modelLister){
     if(typeof b.modelID!=='string')return send(400,{error:'select model'});
     const catalog=await modelLister('coding');
     if(!catalog.models.some(m=>m.id===b.modelID&&m.availability==='verified-response'))return send(409,{error:'model unavailable or not free'});
    }
    if(!registry.claimPilot({id:b.id,grant:grant('submit'),repository,now:clock()}))return send(409,{error:'already attempted; reconcile manually'});
    try{const evidence=await pilotRunner(b.modelID);registry.finishPilot(b.id,'pilot-verified',evidence,clock());return send(200,{state:'pilot-verified',evidence});}
    catch(e){const allowed=['timeout-ambiguous','output-limit-ambiguous','launch-failed','provider-failed','invalid output','invalid provider event','provider error','unexpected tool use','candidate outside allowed grammar','acceptance failed'];const reason=e?.name==='TimeoutError'?'timeout-ambiguous':(allowed.includes(e?.message)||/^http-(?:auth-missing|health-version|price-not-zero|tool-catalog|session-policy|message-unverified|response-limit|status-[0-9]{3})$/.test(e?.message))?e.message:'unknown-pilot-error';registry.finishPilot(b.id,'blocked-reconcile',{reason},clock());console.error('VHQ pilot:',reason);return send(502,{state:'blocked-reconcile',error:reason});}
   }
   if(req.method==='POST'&&req.url==='/api/intake'){
    if(req.headers['content-type']!=='application/json')return send(415,{error:'json required'});
    let size=0,parts=[];for await(const c of req){size+=c.length;if(size>16384)return send(413,{error:'too large'});parts.push(c);}
    let b;try{b=JSON.parse(Buffer.concat(parts).toString());}catch{return send(400,{error:'invalid json'});}
    if(!b||typeof b!=='object')return send(400,{error:'invalid input'});
    const input=prepareInteraction({channel:b.channel,text:b.text,confirmedDigest:b.confirmedDigest});
    if(input.state!=='confirmed-input')return send(400,input);
    const result=registry.submit({projectId:b.projectId,request:{id:b.id,repository,goal:input.text,kind:b.kind,complexity:b.complexity,sensitivity:'public',paid:false,production:false},grant:grant('submit'),routes:[],now:clock()});
    return send(result.state==='denied'?403:200,result);
   }
   return send(404,{error:'not found'});
  }catch{return send(400,{error:'request rejected'});}
 });
}
