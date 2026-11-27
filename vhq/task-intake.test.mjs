import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {PostgresStore} from './postgres-store.mjs';
import {createTaskIntake} from './task-intake.mjs';
const policy={repository:'fixture/local',baseCommit:'a'.repeat(40),allowedPaths:['fixture.mjs'],testPlanId:'synthetic',expiresAt:10000,limits:{maxAttempts:3,maxReviewAttempts:2,deadlineMs:60000,maxPatchBytes:4096}};
const request={id:'fixture-task',goal:'Synthetic task',repository:policy.repository,baseCommit:policy.baseCommit,allowedPaths:['fixture.mjs'],testPlanId:policy.testPlanId};
test('rejects unauthorized scope and expiry before accessing store',async()=>{
 let calls=0,now=1;
 const intake=createTaskIntake({policy,clock:()=>now,enqueueSpec:()=>0,store:{transact(){calls++;}}});
 for(const change of [{repository:'other/repo'},{baseCommit:'b'.repeat(40)},{allowedPaths:['other.mjs']},{testPlanId:'other'},{limits:{}},{role:'admin'}])await assert.rejects(intake({...request,...change}),/outside authorized scope/);
 now=10000;await assert.rejects(intake(request),/expired/);assert.equal(calls,0);
});
test('identical JSONB-reordered spec is existing; changed or orphaned spec is rejected',async()=>{
 const state={tasks:[{id:request.id,role:'dev',goal:request.goal,deps:[],state:'queued'}],specs:{[request.id]:{limits:{maxPatchBytes:4096,deadlineMs:60000,maxReviewAttempts:2,maxAttempts:3},testPlanId:request.testPlanId,allowedPaths:request.allowedPaths,baseCommit:request.baseCommit,repository:request.repository,deps:[],goal:request.goal,role:'dev',id:request.id,version:1}}};
 const intake=createTaskIntake({policy,clock:()=>1,store:{transact:async fn=>fn(state)},enqueueSpec:()=>{throw Error('unexpected enqueue');}});
 assert.deepEqual(await intake(request),{id:request.id,state:'queued',disposition:'existing'});
 await assert.rejects(intake({...request,goal:'changed'}),/conflicting spec/);
 state.specs[request.id].limits.maxAttempts=4;
 await assert.rejects(intake(request),/conflicting spec/);
 delete state.specs[request.id];
 await assert.rejects(intake(request),/conflicting spec/);
});
test('live TaskSpec intake on isolated PostgreSQL',{skip:process.env.VHQ_TEST_TASK_INTAKE!=='1'},async()=>{
 const e=process.env;assert.equal(e.PGHOST,'127.0.0.1');assert.equal(e.PGPORT,'55432');assert.equal(e.PGUSER,'factory_app');assert.equal(e.PGDATABASE,'factory_test_db');assert.ok(e.PGPASSWORD);
 const dir=mkdtempSync(join(tmpdir(),'vhq-intake-'));let store,pool;
 try{
  for(const [file,sha] of Object.entries({'intake.mjs':'9239a6bc4f562b38ae2c2500859b70ed5fd7140b','attempt-store.mjs':'79a73b72e954378cc9edf978f8b035499962ff49'})){
   const bytes=execFileSync('git',['cat-file','blob',sha],{maxBuffer:1048576});assert.equal(createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex'),sha);writeFileSync(join(dir,file),bytes);
  }
  const {enqueueSpec,normalizeDeliveryFailures}=await import(pathToFileURL(join(dir,'attempt-store.mjs')).href);
  const {Pool}=await import('pg');pool=new Pool({host:'127.0.0.1',port:55432,user:'factory_app',password:e.PGPASSWORD,database:'factory_test_db',ssl:false,max:4,connectionTimeoutMillis:3000,statement_timeout:12000});
  store=new PostgresStore({pool,normalizeState:normalizeDeliveryFailures});
  const read=async()=>{const {rows}=await pool.query("SELECT payload,revision::text AS revision,current_database() AS db FROM factory.factory_state WHERE id=1");assert.equal(rows[0]?.db,'factory_test_db');return rows[0];};
  const before=await read(); // Preserve any previous failed test fixtures; do not erase the baseline.
  const baselineIds=before.payload.tasks.map(t=>t.id);
  const intake=createTaskIntake({store,enqueueSpec,policy,clock:()=>1});
  const req={...request,id:'intake-'+randomUUID()};
  const settled=await Promise.allSettled(Array.from({length:8},()=>intake(req)));
  const rejected=settled.find(x=>x.status==='rejected');if(rejected)throw rejected.reason;
  const results=settled.map(x=>x.value);
  assert.equal(results.filter(x=>x.disposition==='created').length,1);assert.equal(results.filter(x=>x.disposition==='existing').length,7);
  const saved=await read();assert.equal(saved.payload.tasks.length,baselineIds.length+1);assert.deepEqual(saved.payload.tasks.filter(t=>t.id!==req.id),before.payload.tasks);assert.equal(saved.payload.tasks.find(t=>t.id===req.id).state,'queued');assert.equal(saved.payload.specs[req.id].baseCommit,policy.baseCommit);
  await assert.rejects(intake({...req,goal:'different goal'}),/conflict/i);assert.deepEqual(await read(),saved);
  await assert.rejects(intake({...req,allowedPaths:['unauthorized.mjs']}),/outside authorized scope/);assert.deepEqual(await read(),saved);
  await store.transact(s=>{s.tasks=s.tasks.filter(t=>t.id!==req.id);delete s.specs[req.id];});
  const after=await read();assert.deepEqual(after.payload.tasks,before.payload.tasks);assert.deepEqual(after.payload.specs??{},before.payload.specs??{});
  console.log('TaskSpec: one created, seven existing, conflict and unauthorized scope rejected; isolated fixture cleaned');
 }finally{try{if(store)await store.close();else if(pool)await pool.end();}finally{rmSync(dir,{recursive:true,force:true});}}
});
