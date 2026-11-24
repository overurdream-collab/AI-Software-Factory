import {claim,submit,review} from './leases.mjs';

// Provider-neutral bounded execution. Workers and reviewers are injected trusted adapters.
// No shell execution or network access is implicit.
export async function tick({store,role,worker,reviewer,execute,verify,clock=Date.now,ttl=60000,maxAttempts=3}){
  if(!worker||!reviewer||worker===reviewer)throw Error('distinct identities required');
  if(typeof execute!=='function'||typeof verify!=='function')throw Error('adapters required');
  const pending=await store.transact(s=>{
    const t=s.tasks.find(t=>t.role===role&&t.state==='review'&&t.worker!==reviewer);
    return t?structuredClone(t):null;
  });
  const task=pending??await store.transact(s=>claim(s,role,worker,clock(),ttl,maxAttempts));
  if(!task)return {state:'idle'};
  if(!pending){
    let artifact;
    try {artifact=await execute(Object.freeze(task));}
    catch(e){return {state:'execution-error',id:task.id};}
    await store.transact(s=>submit(s,task.id,task.token,artifact,clock()));
  }
  const current=await store.transact(s=>structuredClone(s.tasks.find(t=>t.id===task.id)));
  if(current.state!=='review')return {state:'changed',id:task.id};
  const result=await verify(Object.freeze(current));
  if(!result||typeof result.passed!=='boolean'||typeof result.evidence!=='string'||!result.evidence.trim())throw Error('invalid verification result');
  return store.transact(s=>{
    const live=s.tasks.find(t=>t.id===task.id);
    if(live.state!=='review'||live.attempts!==current.attempts||live.artifact!==current.artifact||live.worker!==current.worker)return {state:'changed',id:task.id};
    review(s,task.id,reviewer,result.passed,result.evidence,maxAttempts);
    return {state:live.state,id:task.id};
  });
}
