import {createServer} from 'node:http';
import {readFileSync} from 'node:fs';
import {timingSafeEqual} from 'node:crypto';
import {prepareInteraction} from './interaction.mjs';
const html=readFileSync(new URL('./dashboard.html',import.meta.url));
export function createDashboard({registry,repository,token,expiresAt,clock=Date.now}){
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
   if(req.method==='GET'&&req.url==='/api/status')return send(200,{repository,additionalBudget:0,providers:'not-connected',assignments:registry.list({grant:grant('read'),repository,now:clock()})});
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
