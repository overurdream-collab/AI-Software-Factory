import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {SQLiteStore} from '../src/sqlite-store.mjs';
import {enqueueSpec} from '../src/attempt-store.mjs';
import {claim,submit} from '../src/leases.mjs';
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
 ['clamp','fixtures/p2-clamp/clamp.mjs','fixtures/p2-clamp/checks.mjs','Fix clamp to enforce both lower and upper bounds; preserve named export.'],
 ['sum','fixtures/p3-sum/sum.mjs','fixtures/p3-sum/checks.mjs','Fix sum(values) to add every numeric array element and return zero for empty arrays; preserve named export.']
];
try{
 if(process.argv[2]==='worker'){
  const owner=process.argv[3];
  const task=await store.transact(s=>claim(s,'dev',owner,Date.now(),60000,2));
  assert.ok(task);
  const spec=await store.transact(s=>s.specs[task.id]);
  const row=specs.find(x=>x[0]===task.id);
  const work=join(root,owner);await mkdir(work,{recursive:true});
  const artifact=await withHeartbeat({store,task,owner,clock:Date.now,ttl:60000,deadlineMs:300000,
   operation:(_task,signal)=>executeLiveRepository({spec,attemptId:task.attemptId,leaseToken:task.token,owner,store,repositoryPath:resolve('.'),root:work,
    testPlan:{id:spec.testPlanId,commands:[{argv:['node','--test','--test-reporter=tap',row[2]],cwd:'.'}]},
    runnerLimits:{timeoutMs:60000,memoryMb:256,cpus:1,pids:64,maxOutputBytes:262144},imageDigest,providerConfig:{model,timeoutMs:180000},approvedRepositories:[repository],signal})});
  await store.transact(s=>submit(s,task.id,task.token,artifact,Date.now()));
 }else{
  const baseCommit=(await git(resolve('.'),['rev-parse','HEAD'])).trim();
  const metadata=await (await fetch('http://127.0.0.1:11434/api/tags',{signal:AbortSignal.timeout(5000)})).json();
  const digest=metadata.models.find(m=>m.name===model||m.model===model)?.digest;assert.ok(digest);
  for(const [id,path,,goal] of specs)await store.transact(s=>enqueueSpec(s,{version:1,id,role:'dev',goal:goal+' Return only complete JavaScript source.',deps:[],repository,baseCommit,allowedPaths:[path],testPlanId:'p3-'+id,limits:{maxAttempts:2,maxReviewAttempts:3,deadlineMs:300000,maxPatchBytes:16384}}));
  const run=owner=>new Promise((res,rej)=>{const p=spawn(process.execPath,[process.argv[1],'worker',owner],{stdio:'inherit'});p.on('error',rej);p.on('exit',(code,signal)=>res({owner,pid:p.pid,code,signal}));});
  const results=await Promise.all([run('worker-one'),run('worker-two')]);
  const evidence=await store.transact(s=>({tasks:s.tasks.map(({id,state,artifact})=>({id,state,artifact})),attempts:s.attempts.map(({token,...a})=>a),events:s.repositoryEvidence}));
  await writeFile(join(root,'evidence.json'),JSON.stringify({baseCommit,imageDigest,model,digest,results,...evidence},null,2));
  assert.ok(results.every(x=>x.code===0));assert.notEqual(results[0].pid,results[1].pid);
  assert.equal(evidence.tasks.filter(t=>t.state==='review').length,2);
  const a=evidence.attempts.filter(x=>x.phase==='execution');assert.equal(a.length,2);
  assert.ok(Math.min(...a.map(x=>x.finishedAt))>Math.max(...a.map(x=>x.startedAt)),'no overlapping execution');
  assert.notEqual(JSON.parse(evidence.tasks[0].artifact).patchSha256,JSON.parse(evidence.tasks[1].artifact).patchSha256);
 }
}finally{store.close();}
