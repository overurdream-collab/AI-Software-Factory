import {runHttpPilot,listHttpModels} from './opencode-http.mjs';
import {openRegistry} from './registry.mjs';
import {createDashboard} from './dashboard-server.mjs';
import {randomBytes} from 'node:crypto';
import {openPostgresRuntime} from './postgres-runtime.mjs';
const backend=process.env.VHQ_RUNTIME_BACKEND||'sqlite';
if(!['sqlite','postgres'].includes(backend))throw Error('unsupported runtime backend');
const postgres=backend==='postgres'?await openPostgresRuntime():null;
const token=randomBytes(32).toString('hex');
const registry=openRegistry(process.env.VHQ_DB||'vhq-local.sqlite');
const observations={'deepseek-v4.1-flash-free':'quota-reported'};
let probing=false;
async function probeModel(modelID){
 if(probing)throw Error('probe-busy');
 probing=true;
 try{const result=await runHttpPilot({modelID,probe:true,onStage:stage=>console.log('VHQ probe:',stage)});observations[modelID]='verified-response';return {modelID,state:'verified-response',checkedAt:result.checkedAt};}
 catch(e){const state=['http-status-429','http-quota-or-rate-limit','http-status-402'].includes(e.message)?'quota-reported':e.name==='TimeoutError'?'timeout-unknown':'attempt-blocked';observations[modelID]=state;return {modelID,state};}
 finally{probing=false;}
}
const server=createDashboard({registry,...(postgres?{runtimeReader:postgres.read}:{}),repository:'overurdream-collab/AI-Software-Factory',token,probeModel,modelLister:kind=>listHttpModels({kind,observations}),pilotRunner:async modelID=>{try{const result=await runHttpPilot({modelID,onStage:stage=>console.log('VHQ HTTP:',stage)});observations[modelID]='verified-response';return result;}catch(e){observations[modelID]=e.message==='http-status-429'?'quota-reported':'attempt-blocked';throw e;}},pilotEnabled:process.env.VHQ_ENABLE_FREE_PILOT==='1'&&!!process.env.VHQ_OPENCODE_PASSWORD,expiresAt:Date.now()+3600000});
server.listen(8787,'127.0.0.1',()=>{console.log('Runtime backend: '+backend);console.log('Open http://127.0.0.1:8787');console.log('Local operator token (expires in 1 hour; do not share): '+token);});
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>server.close(async()=>{try{await postgres?.close();}finally{registry.close();}}));
