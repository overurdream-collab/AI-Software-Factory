import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {PostgresStore} from './postgres-store.mjs';
const pinned={'intake.mjs':'9239a6bc4f562b38ae2c2500859b70ed5fd7140b','attempt-store.mjs':'79a73b72e954378cc9edf978f8b035499962ff49','leases.mjs':'60fc8bef83ec4b026fc3691bf427167628131294'};
function loadPinned(dir){
 for(const [file,sha] of Object.entries(pinned)){
  const bytes=execFileSync('git',['cat-file','blob',sha],{maxBuffer:1048576});
  assert.equal(createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex'),sha);
  writeFileSync(join(dir,file),bytes);
 }
}
test('D lease recovery and stale result fencing on isolated PostgreSQL',{skip:process.env.VHQ_TEST_POSTGRES_RECOVERY!=='1'},async()=>{
 const e=process.env;
 assert.equal(e.PGHOST,'127.0.0.1');assert.equal(e.PGPORT,'55432');assert.equal(e.PGUSER,'factory_app');assert.equal(e.PGDATABASE,'factory_test_db');assert.ok(e.PGPASSWORD);
 const dir=mkdtempSync(join(tmpdir(),'vhq-d-'));
 let pool,store;
 try{
  loadPinned(dir);
  const {enqueueSpec,normalizeDeliveryFailures}=await import(pathToFileURL(join(dir,'attempt-store.mjs')).href);
  const {claim,submit,review}=await import(pathToFileURL(join(dir,'leases.mjs')).href);
  const {Pool}=await import('pg');
  const makePool=()=>new Pool({host:'127.0.0.1',port:55432,user:'factory_app',password:e.PGPASSWORD,database:'factory_test_db',ssl:false,max:2,connectionTimeoutMillis:3000,statement_timeout:12000});
  pool=makePool();store=new PostgresStore({pool,normalizeState:normalizeDeliveryFailures});
  const read=async()=>{const {rows}=await pool.query("SELECT current_database() AS db,payload,revision::text AS revision FROM factory.factory_state WHERE id=1");assert.equal(rows[0]?.db,'factory_test_db');return rows[0];};
  const before=await read();assert.deepEqual(before.payload.tasks,[]);assert.ok(!before.payload.attempts?.length);
  const id='recovery-'+randomUUID();
  const spec={version:1,id,role:'dev',goal:'Synthetic lease recovery fixture',deps:[],repository:'fixture/local',baseCommit:'a'.repeat(40),allowedPaths:['fixture.mjs'],testPlanId:'synthetic',limits:{maxAttempts:3,maxReviewAttempts:2,deadlineMs:60000,maxPatchBytes:4096}};
  await store.transact(s=>{assert.equal(enqueueSpec(s,spec),1);});
  const first=await store.transact(s=>claim(s,'dev','worker-1',1000,100));
  assert.equal(first.id,id);assert.equal(first.attempts,1);
  // Close the first client pool; reopen against durable storage. Synthetic clock advances past lease.
  await store.close();pool=makePool();store=new PostgresStore({pool,normalizeState:normalizeDeliveryFailures});
  const second=await store.transact(s=>claim(s,'dev','worker-2',1101,100));
  assert.equal(second.id,id);assert.equal(second.attempts,2);assert.notEqual(second.token,first.token);
  const checkpoint=await read();
  await assert.rejects(store.transact(s=>submit(s,id,first.token,'stale artifact',1102)),/invalid or expired lease/);
  assert.deepEqual(await read(),checkpoint);
  await store.transact(s=>submit(s,id,second.token,'synthetic artifact',1103));
  await assert.rejects(store.transact(s=>review(s,id,'worker-2',true,'self review')),/independent evidence required/);
  await store.transact(s=>review(s,id,'reviewer-f',true,'synthetic independent evidence'));
  const end=await read();
  assert.equal(end.payload.tasks.find(t=>t.id===id).state,'accepted');
  assert.equal(end.payload.attempts.find(a=>a.token===first.token).state,'expired');
  assert.equal(end.payload.attempts.find(a=>a.token===second.token).state,'submitted');
  assert.equal(BigInt(end.revision),BigInt(before.revision)+5n);
  await store.transact(s=>{s.tasks=s.tasks.filter(t=>t.id!==id);delete s.specs[id];s.attempts=s.attempts.filter(a=>a.taskId!==id);});
  console.log('D pinned lease recovery: expired attempt, stale result rejected, independent review accepted; isolated fixture cleaned');
 }finally{try{if(store)await store.close();else if(pool)await pool.end();}finally{rmSync(dir,{recursive:true,force:true});}}
});
