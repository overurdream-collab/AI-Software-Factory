import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DurableStore} from '../src/durable-store.mjs';
import {tick} from '../src/worker-loop.mjs';
test('execute, fail verification, repair, accept and resume',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'factory-loop-'));
 try{
 const path=join(dir,'state.json');
 const store=new DurableStore(path);
 await store.transact(s=>s.tasks.push({id:'a',role:'dev',state:'queued',attempts:0}));
 const args={store,role:'dev',worker:'dev-1',reviewer:'qa-1',execute:async t=>'artifact-'+t.attempts,verify:async t=>({passed:t.attempts===2,evidence:'fixture-'+t.attempts})};
 assert.equal((await tick(args)).state,'queued');
 assert.equal((await tick({...args,store:new DurableStore(path)})).state,'accepted');
 assert.equal((await tick(args)).state,'idle');
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('review survives interrupted verifier without reexecution',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'factory-review-'));
 try{
 const store=new DurableStore(join(dir,'state.json'));
 await store.transact(s=>s.tasks.push({id:'a',role:'dev',state:'queued',attempts:0}));
 let calls=0;
 const args={store,role:'dev',worker:'dev',reviewer:'qa',execute:async()=>{calls++;return 'fixture';},verify:async()=>{throw Error('interrupted');}};
 await assert.rejects(tick(args));
 assert.equal((await tick({...args,verify:async()=>({passed:true,evidence:'fixture pass'})})).state,'accepted');
 assert.equal(calls,1);
 }finally{await rm(dir,{recursive:true,force:true});}
});
