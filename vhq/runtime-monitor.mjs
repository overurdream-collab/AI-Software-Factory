import {DatabaseSync} from 'node:sqlite';
import {statSync} from 'node:fs';
const states=new Set(['queued','running','review','accepted','blocked']);
const label=v=>typeof v==='string'?v.slice(0,160):null;
const num=v=>Number.isSafeInteger(v)&&v>=0?v:null;
export function projectRuntime(state,now=Date.now()){
 if(state?.version!==1||!Array.isArray(state.tasks)||state.tasks.length>10000)throw Error('unsupported-state');
 const tasks=state.tasks.map(t=>{
  if(!t||typeof t.id!=='string'||!states.has(t.state))throw Error('unsupported-task');
  const execution=t.state==='running',review=t.state==='review';
  const owner=label(execution?t.worker:review?t.reviewOwner:null);
  const expiresAt=num(execution?t.expiresAt:review?t.reviewExpiresAt:null);
  const lease=execution||review?(owner&&expiresAt!==null?(expiresAt>now?'unexpired':'expired'):'unassigned'):'none';
  return {id:label(t.id),role:label(t.role),state:t.state,owner,expiresAt,lease,attempts:num(t.attempts),reviewAttempts:num(t.reviewAttempts)};
 });
 const counts={queued:0,running:0,review:0,accepted:0,blocked:0,expired:0,unexpired:0};
 for(const t of tasks){counts[t.state]++;if(t.lease==='expired'||t.lease==='unexpired')counts[t.lease]++;}
 return {state:'snapshot',source:'factory_state',checkedAt:now,counts,tasks:tasks.slice(0,200),truncated:tasks.length>200,heartbeatTimestampAvailable:false};
}
export function readRuntime({path=process.env.VHQ_FACTORY_DB,clock=Date.now}={}){
 const now=clock();if(!path)return {state:'not-configured',checkedAt:now};
 let db;try{
  if(!statSync(path).isFile())throw Error('not-file');
  db=new DatabaseSync(path,{readOnly:true});
  db.exec('PRAGMA query_only=ON; PRAGMA busy_timeout=1500;');
  const row=db.prepare('SELECT CASE WHEN length(payload)<=8388608 THEN payload ELSE NULL END AS payload FROM factory_state WHERE id=1').get();
  if(typeof row?.payload!=='string')throw Error('unsupported-state');
  return projectRuntime(JSON.parse(row.payload),now);
 }catch{return {state:'unavailable',checkedAt:now};}finally{db?.close();}
}
// A valid lease is not proof of active work. Heartbeat renewal timestamp is not
// persisted in the inspected schema; never fabricate it or a progress percentage.
