import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {realpathSync} from 'node:fs';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import {PostgresStore} from './postgres-store.mjs';
const PIN='0c1ba9cf9f55606b79b796f89aae9b6fade0e23d';
test('D integration: persisted lease recovery and stale result fencing',{skip:process.env.VHQ_TEST_POSTGRES_D!=='1'},async()=>{
 const e=process.env;
 assert.equal(e.PGHOST,'127.0.0.1');assert.equal(e.PGPORT,'55432');assert.equal(e.PGUSER,'factory_app');assert.equal(e.PGDATABASE,'factory_test_db');assert.ok(e.PGPASSWORD);
 assert.ok(e.VHQ_D_WORKTREE,'pinned D worktree required');
 const root=realpathSync(e.VHQ_D_WORKTREE);
 const git=(...args)=>execFileSync('git',['-C',root,...args],{encoding:'utf8'}).trim();
 assert.equal(git('rev-parse','HEAD'),PIN);
 assert.equal(git('status','--porcelain','--untracked-files=all'),'','D worktree must be clean');
 const load=p=>import(pathToFileURL(join(root,p)).href);
 const {enqueueSpec,normalizeDeliveryFailures}=await load('src/attempt-store.mjs');
 const {claim,submit,review}=await load('src/leases.mjs');
 const {Pool}=await import('pg');
 const open=()=>{const pool=new Pool({host:'127.0.0.1',port:55432,user:'factory_app',password:e.PGPASSWORD,database:'factory_test_db',ssl:false,max:2,connectionTimeoutMillis:3000,statement_timeout:12000});return {pool,store:new PostgresStore({pool,normalizeState:normalizeDeliveryFailures})};};
 const id='vhq-d-'+randomUUID();let ctx=open();
 const read=async()=>{const r=await ctx.pool.query("SELECT current_database() AS db,payload,revision::text AS revision FROM factory.factory_state WHERE id=1");assert.equal(r.rows[0]?.db,'factory_test_db');return r.rows[0];};
 try{
  const initial=await read();assert.deepEqual(initial.payload.tasks,[],'dedicated empty test database required');
  const spec={version:1,id,role:'dev',goal:'synthetic recovery fixture only',deps:[],repository:'overurdream-collab/AI-Software-Factory',baseCommit:PIN,allowedPaths:['fixture.txt'],testPlanId:'synthetic',limits:{maxAttempts:3,maxReviewAttempts:2,deadlineMs:60000,maxPatchBytes:1024}};
  assert.equal(await ctx.store.transact(s=>enqueueSpec(s,spec)),1);
  const first=await ctx.store.transact(s=>claim(s,'dev','worker-old',1000,100));
  assert.equal(first.id,id);
  // Close the original connection pool and reopen; time is deliberately simulated.
  await ctx.store.close();ctx=open();
  const persisted=await read();assert.equal(persisted.payload.tasks[0].state,'running');
  const second=await ctx.store.transact(s=>claim(s,'dev','worker-new',1100,100));
  assert.equal(second.id,id);assert.notEqual(second.token,first.token);assert.notEqual(second.attemptId,first.attemptId);assert.equal(second.attempts,2);
  const beforeReject=await read();
  await assert.rejects(ctx.store.transact(s=>submit(s,id,first.token,'stale fixture',1101)),/invalid or expired lease/);
  assert.deepEqual(await read(),beforeReject);
  await ctx.store.transact(s=>submit(s,id,second.token,'synthetic artifact',1102));
  await assert.rejects(ctx.store.transact(s=>review(s,id,'worker-new',true,'synthetic evidence')),/independent evidence required/);
  await ctx.store.transact(s=>review(s,id,'reviewer-fixture',true,'synthetic evidence'));
  const final=await read();const task=final.payload.tasks.find(t=>t.id===id);
  assert.equal(task.state,'accepted');assert.equal(task.reviewer,'reviewer-fixture');
  assert.deepEqual(final.payload.attempts.filter(a=>a.taskId===id).map(a=>a.state),['expired','submitted']);
  assert.equal(BigInt(final.revision),BigInt(initial.revision)+5n);
  console.log('D pinned recovery fixture passed; revision',final.revision,'attempts expired/submitted; synthetic acceptance only');
  // Remove only the successful test fixture, preserving unrelated fields.
  await ctx.store.transact(s=>{s.tasks=s.tasks.filter(t=>t.id!==id);delete s.specs[id];s.attempts=s.attempts.filter(a=>a.taskId!==id);});
 }finally{await ctx.store.close();}
});
