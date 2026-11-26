import {test} from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {openRegistry} from './registry.mjs';
import {createDashboard} from './dashboard-server.mjs';
import {runPilot} from './opencode-pilot.mjs';
test('HTTP pilot is authenticated, explicitly confirmed, verified and not duplicated',async()=>{
 const registry=openRegistry(':memory:'),repository='org/repo',token='a'.repeat(64);
 let calls=0;
 const server=createDashboard({registry,repository,token,expiresAt:Date.now()+60000,pilotEnabled:true,pilotRunner:async()=>{calls++;return runPilot(async()=>JSON.stringify({type:'text',part:{text:'export function add(a,b){return a+b;}'}}));}});
 try{
 server.listen(0,'127.0.0.1');await once(server,'listening');
 const base='http://127.0.0.1:'+server.address().port;
 const post=(path,data,auth=true)=>fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json',...(auth?{Authorization:'Bearer '+token}:{})},body:JSON.stringify(data)});
 let response=await post('/api/intake',{id:'first',projectId:'pilot',channel:'text',text:'جمع رقمين',kind:'coding',complexity:'simple'});
 assert.equal(response.status,200);assert.equal((await response.json()).state,'queued');
 assert.equal((await post('/api/pilot',{id:'first',confirm:'synthetic-addition-only'},false)).status,401);
 assert.equal((await post('/api/pilot',{id:'first'})).status,400);
 response=await post('/api/pilot',{id:'first',confirm:'synthetic-addition-only'});
 assert.equal(response.status,200);assert.equal((await response.json()).evidence.passed,5);
 assert.equal((await post('/api/pilot',{id:'first',confirm:'synthetic-addition-only'})).status,409);
 assert.equal(calls,1);
 const state=await (await fetch(base+'/api/status',{headers:{Authorization:'Bearer '+token}})).json();
 assert.equal(state.assignments[0].pilot.state,'pilot-verified');
 assert.equal(state.assignments[0].state,'queued');
 }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));registry.close();}
});
