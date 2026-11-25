import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {SQLiteStore} from '../src/sqlite-store.mjs';
import {claim,submit} from '../src/leases.mjs';
test('process crash rolls back transaction and releases lock',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'factory-sqlite-'));
 const path=join(dir,'state.db');
 let store;
 try{
  store=new SQLiteStore(path);
  await store.transact(s=>s.tasks.push({id:'a',role:'dev',state:'queued',attempts:0}));
  const child=spawnSync(process.execPath,['--input-type=module','-e',`import {DatabaseSync} from 'node:sqlite';const db=new DatabaseSync(process.argv[1]);db.exec('BEGIN IMMEDIATE');db.exec("UPDATE factory_state SET payload='corrupt'");process.exit(17);`,path],{timeout:10000});
  assert.equal(child.status,17);
  assert.equal(await store.transact(s=>s.tasks[0].state),'queued');
  const first=await store.transact(s=>claim(s,'dev','w1',100,10));
  store.close();store=new SQLiteStore(path);
  const second=await store.transact(s=>claim(s,'dev','w2',110,10));
  assert.notEqual(first.token,second.token);
  await assert.rejects(store.transact(s=>submit(s,'a',first.token,'stale',111)));
  await store.transact(s=>submit(s,'a',second.token,'fresh',111));
  assert.equal(await store.transact(s=>s.tasks[0].state),'review');
 }finally{store?.close();await rm(dir,{recursive:true,force:true});}
});
test('rollback on callback failure',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'factory-sqlite-'));
 const store=new SQLiteStore(join(dir,'state.db'));
 try{
  await assert.rejects(store.transact(s=>{s.tasks.push({id:'bad'});throw Error('abort');}));
  assert.deepEqual(await store.transact(s=>s.tasks),[]);
 }finally{store.close();await rm(dir,{recursive:true,force:true});}
});

test('legacy delivery failure migration survives database reopen without duplication',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'factory-delivery-migration-'));
 const path=join(dir,'state.db');let store=new SQLiteStore(path);
 try{
  await store.transact(s=>{s.deliveries=[{key:'legacy',state:'delivered',failure:'previous CI error',prNumber:7}];});
  store.close();store=new SQLiteStore(path);
  const d=await store.transact(s=>structuredClone(s.deliveries[0]));
  assert.equal(d.state,'delivered');assert.equal(d.prNumber,7);
  assert.equal(Object.hasOwn(d,'failure'),false);
  assert.deepEqual(d.failureHistory,[{reason:'previous CI error',at:null,state:'delivered'}]);
  store.close();store=new SQLiteStore(path);
  assert.deepEqual(await store.transact(s=>s.deliveries[0]),d);
 }finally{store.close();await rm(dir,{recursive:true,force:true});}
});
