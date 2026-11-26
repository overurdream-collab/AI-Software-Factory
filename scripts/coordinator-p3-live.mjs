import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {createReconciler} from '../src/reconciler.mjs';
import {spawn} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {SQLiteStore} from '../src/sqlite-store.mjs';
import {enqueueSpec} from '../src/attempt-store.mjs';
import {claim,submit,failExecution} from '../src/leases.mjs';
import {withHeartbeat} from '../src/heartbeat.mjs';
import {executeLiveRepository} from '../src/repository-worker.mjs';
import {git} from '../src/workspace.mjs';
const root=resolve(process.env.P3_STATE_DIR);
const db=join(root,'state.sqlite');
const repository='overurdream-collab/AI-Software-Factory';
const imageDigest=process.env.P3_IMAGE_DIGEST;
const model='qwen2.5-coder:1.5b';
const store=new SQLiteStore(db);
const specs=[
 ['clamp','fixtures/p2-clamp/clamp.mjs','fixtures/p2-clamp/checks.mjs','The current clamp implementation ignores the lower bound. Fix clamp(value, lower, upper) to enforce BOTH bounds: return lower below the lower bound, upper above the upper bound, and the original value inside the interval. Preserve the named ES module export clamp.'],
 ['sum','fixtures/p3-sum/sum.mjs','fixtures/p3-sum/checks.mjs','The current sum implementation omits an array element. Fix sum(values) so every numeric element contributes exactly once, including the first and last; return zero for an empty array. Preserve the named ES module export sum.']
];
try{
 if(process.argv[2]==='worker'){
  const owner=process.argv[3];
  const task=await store.transact(s=>claim(s,'dev',owner,Date.now(),15000,2));
  assert.ok(task);
  const spec=await store.transact(s=>s.specs[task.id]);
  const row=specs.find(x=>x[0]===task.id);
  const work=join(root,owner);await mkdir(work,{recursive:true});
  try {
  const artifact=await withHeartbeat({store,task,owner,clock:Date.now,ttl:15000,deadlineMs:300000,
   operation:(_task,signal)=>executeLiveRepository({spec,attemptId:task.attemptId,leaseToken:task.token,owner,store,repositoryPath:resolve('.'),root:work,
    testPlan:{id:spec.testPlanId,commands:[{argv:['node','--test','--test-reporter=tap',row[2]],cwd:'.'}]},
    runnerLimits:{timeoutMs:60000,memoryMb:256,cpus:1,pids:64,maxOutputBytes:262144},imageDigest,providerConfig:{model,timeoutMs:180000},approvedRepositories:[repository],signal})});
  await store.transact(s=>submit(s,task.id,task.token,artifact,Date.now()));
  } catch(error) { await store.transact(s=>failExecution(s,task.id,task.token,Date.now())); throw error; }
 }else{
  const baseCommit=(await git(resolve('.'),['rev-parse','HEAD'])).trim();
  const metadata=await (await fetch('http://127.0.0.1:11434/api/tags',{signal:AbortSignal.timeout(5000)})).json();
  const digest=metadata.models.find(m=>m.name===model||m.model===model)?.digest;assert.ok(digest);
  for(const [id,path,,goal] of specs)await store.transact(s=>enqueueSpec(s,{version:1,id,role:'dev',goal:goal+' Return only complete JavaScript source.',deps:[],repository,baseCommit,allowedPaths:[path],testPlanId:'p3-'+id,limits:{maxAttempts:2,maxReviewAttempts:3,deadlineMs:300000,maxPatchBytes:16384}}));
  const run=owner=>{
   const p=spawn(process.execPath,[process.argv[1],'worker',owner],{stdio:'inherit'});
   const done=new Promise((res,rej)=>{p.on('error',rej);p.on('exit',(code,signal)=>res({owner,pid:p.pid,code,signal}));});
   return {p,done};
  };
  const waitFor=async(fn,ms=120000)=>{
   const end=Date.now()+ms;
   while(Date.now()<end){const v=await fn();if(v)return v;await delay(100);}
   throw Error('timed out waiting for live state');
  };
  const a=run('worker-one'),b=run('worker-two');
  let old,killAt,results=[],cleaned=[];
  try{
   old=await waitFor(()=>store.transact(s=>{
    const x=s.tasks.find(t=>t.worker==='worker-one'&&t.state==='running');
    const y=s.tasks.find(t=>t.worker==='worker-two'&&t.state==='running');
    return x&&y&&s.resources?.some(r=>r.attemptId===x.attemptId&&r.cleanedAt===undefined)?structuredClone(x):null;
   }));
   killAt=Date.now();assert.ok(a.p.kill('SIGKILL'));
   const killed=await a.done;assert.equal(killed.signal,'SIGKILL');results.push(killed);
   assert.equal(b.p.exitCode,null,'survivor must still be running at interruption');
   await waitFor(()=>store.transact(s=>s.tasks.find(t=>t.id===old.id)?.expiresAt<=Date.now()));
   cleaned=await createReconciler({store})();
   const replacement=run('worker-replacement');
   try{
    await waitFor(()=>store.transact(s=>s.tasks.some(t=>t.id===old.id&&t.attemptId!==old.attemptId)));
    await assert.rejects(store.transact(s=>submit(s,old.id,old.token,'stale',Date.now())),/invalid or expired lease/);
    results.push(...await Promise.all([b.done,replacement.done]));
   }finally{if(replacement.p.exitCode===null&&replacement.p.signalCode===null)replacement.p.kill('SIGKILL');}
   assert.ok(results.slice(1).every(x=>x.code===0));
   const evidence=await store.transact(s=>({tasks:s.tasks.map(({id,state,artifact})=>({id,state,artifact})),attempts:s.attempts.map(({token,...a})=>a),events:s.repositoryEvidence}));
   assert.equal(evidence.tasks.filter(t=>t.state==='review').length,2);
   assert.ok(evidence.attempts.some(x=>x.attemptId===old.attemptId&&x.state==='expired'));
   assert.notEqual(JSON.parse(evidence.tasks[0].artifact).patchSha256,JSON.parse(evidence.tasks[1].artifact).patchSha256);
   await writeFile(join(root,'evidence.json'),JSON.stringify({baseCommit,imageDigest,model,digest,results,killAt,cleaned,staleRejected:true,...evidence},null,2));
  }catch(error){
   const snapshot=await store.transact(s=>({tasks:s.tasks.map(({id,state,attempts,attemptId,failure})=>({id,state,attempts,attemptId,failure})),attempts:(s.attempts??[]).map(({token,...a})=>a),resources:(s.resources??[]).map(({leaseToken,...r})=>r)}));
   await writeFile(join(root,'evidence.json'),JSON.stringify({passed:false,baseCommit,imageDigest,model,digest,results,killAt,cleaned,error:error.name,...snapshot},null,2));
   throw error;
  }finally{
   for(const x of [a,b])if(x.p.exitCode===null&&x.p.signalCode===null)x.p.kill('SIGKILL');
  }
 }
}finally{store.close();}
