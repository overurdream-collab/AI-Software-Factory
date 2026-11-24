import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DurableStore} from '../src/durable-store.mjs';
import {claim,submit,review} from '../src/leases.mjs';
test('restart, expiry, stale token and independent approval',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'factory-'));
 try{
  const path=join(dir,'state.json');
  const a=new DurableStore(path);
  const old=await a.transact(s=>{s.tasks.push({id:'a',role:'dev',state:'queued',attempts:0});return claim(s,'dev','w1',100,10);});
  const b=new DurableStore(path);
  assert.equal(await b.transact(s=>claim(s,'dev','w2',105,10)),null);
  const fresh=await b.transact(s=>claim(s,'dev','w2',110,10));
  assert.notEqual(old.token,fresh.token);
  await assert.rejects(b.transact(s=>submit(s,'a',old.token,'old',111)));
  await b.transact(s=>submit(s,'a',fresh.token,'commit',111));
  await assert.rejects(b.transact(s=>review(s,'a','w2',true,'tests')));
  await b.transact(s=>review(s,'a','qa',true,'tests'));
  assert.equal(await a.transact(s=>s.tasks[0].state),'accepted');
  await writeFile(path+'.lock','');
  await assert.rejects(a.transact(()=>{}),{code:'EEXIST'});
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('expired last attempt blocks further claims',()=>{
 const s={tasks:[{id:'a',role:'dev',state:'queued',attempts:0}]};
 claim(s,'dev','w',0,10,1);
 assert.equal(claim(s,'dev','w2',10,10,1),null);
 assert.equal(s.tasks[0].state,'blocked');
});
