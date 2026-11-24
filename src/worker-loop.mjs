import {claim,submit} from './leases.mjs';
import {reserveReview,finishReview,releaseReview} from './review-lease.mjs';
import {withHeartbeat} from './heartbeat.mjs';
export async function tick({store,role,worker,reviewer,execute,verify,clock=Date.now,ttl=60000,maxAttempts=3}){
 if(!worker||!reviewer||worker===reviewer)throw Error('distinct identities required');
 if(typeof execute!=='function'||typeof verify!=='function')throw Error('adapters required');
 let current=await store.transact(s=>reserveReview(s,role,reviewer,clock(),ttl));
 if(!current){
  const task=await store.transact(s=>claim(s,role,worker,clock(),ttl,maxAttempts));
  if(!task)return {state:'idle'};
  let artifact;
  try{artifact=await withHeartbeat({store,task,owner:worker,clock,ttl,operation:execute});}
  catch{return {state:'execution-error',id:task.id};}
  current=await store.transact(s=>{
   submit(s,task.id,task.token,artifact,clock());
   return reserveReview(s,role,reviewer,clock(),ttl,task.id);
  });
  if(!current)return {state:'changed',id:task.id};
 }
 try{
  const result=await withHeartbeat({store,task:current,owner:reviewer,clock,ttl,review:true,operation:verify});
  if(!result||typeof result.passed!=='boolean'||typeof result.evidence!=='string'||!result.evidence.trim())throw Error('invalid verification result');
  return await store.transact(s=>({state:finishReview(s,current.id,current.reviewToken,clock(),result.passed,result.evidence,maxAttempts),id:current.id}));
 }catch(e){
  await store.transact(s=>releaseReview(s,current.id,current.reviewToken));
  throw e;
 }
}
