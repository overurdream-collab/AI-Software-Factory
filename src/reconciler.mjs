import {invoke} from './sandbox.mjs';

// Recheck durable eligibility immediately before removing the immutable container ID.
export function createReconciler({store,resourceApi,clock=Date.now,docker=invoke}){
 return async function reconcile(){
  const api=resourceApi??await import('./attempt-store.mjs');
  const resources=await store.transact(s=>api.listReclaimableResources(s,clock()));
  const cleaned=[];
  for(const r of resources){
   if(r.kind!=='docker'||!/^factory-project-[a-f0-9-]{36}$/.test(r.name))continue;
   const inspect=await docker(['container','inspect',r.name],'',10000);
   let container;
   if(inspect.code===0){
    [container]=JSON.parse(inspect.stdout);
    const labels=container?.Config?.Labels;
    if(!/^[a-f0-9]{64}$/.test(container?.Id??'')||container.Name!=='/'+r.name||
     labels?.['factory.runtime']!=='project-v1'||labels?.['factory.task']!==r.taskId||
     labels?.['factory.attempt']!==r.attemptId)continue;
   }else if(!/No such (container|object)/i.test(inspect.stderr))throw Error('container inspection failed');
   const eligible=await store.transact(s=>api.listReclaimableResources(s,clock()).some(x=>x.id===r.id&&x.name===r.name&&x.attemptId===r.attemptId));
   if(!eligible)continue;
   if(container){
    const removed=await docker(['rm','-f',container.Id],'',10000);
    if(removed.code!==0&&!/No such container/i.test(removed.stderr))throw Error('orphan cleanup failed');
   }
   // Missing containers may represent an in-flight create after client failure.
   // Leave absent registrations eligible for later periodic inspection.
   if(!container)continue;
   await store.transact(s=>api.markResourceCleaned(s,r.id,clock()));
   cleaned.push(r.id);
  }
  return cleaned;
 };
}
