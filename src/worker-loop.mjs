import {claim,submit,failExecution} from './leases.mjs';
import {reserveReview,finishReview,failReview} from './review-lease.mjs';
import {withHeartbeat} from './heartbeat.mjs';
export async function tick({store,role,worker,reviewer,execute,verify,clock=Date.now,ttl=60000,maxAttempts=3,maxReviewAttempts=3,deadlineMs=300000,signal}){
 if(!Number.isSafeInteger(deadlineMs)||deadlineMs<1||deadlineMs>3600000)throw Error('invalid deadline');
 if(!Number.isSafeInteger(maxReviewAttempts)||maxReviewAttempts<1)throw Error('invalid review budget');
 if(!worker||!reviewer||worker===reviewer)throw Error('distinct identities required');
 if(typeof execute!=='function'||typeof verify!=='function')throw Error('adapters required');
 signal?.throwIfAborted();
 let current=await store.transact(s=>reserveReview(s,role,reviewer,clock(),ttl,undefined,maxReviewAttempts));
 if(!current){
  const task=await store.transact(s=>claim(s,role,worker,clock(),ttl,maxAttempts));
  if(!task)return {state:'idle'};
  let artifact;
  try{artifact=await withHeartbeat({store,task,owner:worker,clock,ttl,operation:execute,deadlineMs,signal});}
  catch{await store.transact(s=>failExecution(s,task.id,task.token,clock()));return {state:'execution-error',id:task.id};}
  current=await store.transact(s=>{
   submit(s,task.id,task.token,artifact,clock());
   return reserveReview(s,role,reviewer,clock(),ttl,task.id,maxReviewAttempts);
  });
  if(!current)return {state:'changed',id:task.id};
 }
 try{
  const result=await withHeartbeat({store,task:current,owner:reviewer,clock,ttl,review:true,operation:verify,deadlineMs,signal});
  if(!result||typeof result.passed!=='boolean'||typeof result.evidence!=='string'||!result.evidence.trim())throw Error('invalid verification result');
  return await store.transact(s=>({state:finishReview(s,current.id,current.reviewToken,clock(),result.passed,result.evidence,maxAttempts),id:current.id}));
 }catch(e){
  await store.transact(s=>failReview(s,current.id,current.reviewToken,clock()));
  throw e;
 }
}
