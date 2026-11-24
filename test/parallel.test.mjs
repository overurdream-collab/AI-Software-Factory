import {test} from 'node:test';
import assert from 'node:assert/strict';
import {SQLiteStore} from '../src/sqlite-store.mjs';
import {runRound} from '../src/parallel.mjs';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
test('parallel independent tasks, dependency gate, durable resume',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'factory-parallel-'));let store;
 try{
 const path=join(dir,'state.db');store=new SQLiteStore(path);
 await store.transact(s=>s.tasks.push(...['a','b','c'].map(id=>({id,role:id==='c'?'qa':'dev',deps:id==='c'?['a','b']:[],state:'queued',attempts:0}))));
 let active=0,peak=0;
 const worker=id=>({role:'dev',worker:id,reviewer:'review-'+id,execute:async t=>{active++;peak=Math.max(peak,active);await new Promise(r=>setTimeout(r,30));active--;return t.id;},verify:async()=>({passed:true,evidence:'fixture'})});
 const results=await runRound({store,workers:[worker('one'),worker('two')],maxParallel:2});
 assert.equal(peak,2);assert.deepEqual(results.map(r=>r.state),['accepted','accepted']);
 store.close();store=new SQLiteStore(path);
 const result=await runRound({store,workers:[{...worker('three'),role:'qa'}]});
 assert.equal(result[0].id,'c');assert.equal(result[0].state,'accepted');
 }finally{store?.close();await rm(dir,{recursive:true,force:true});}
});
test('reject overlapping identities and honor stop signal',async()=>{
 const w={worker:'a',reviewer:'b'};
 await assert.rejects(runRound({workers:[w,{worker:'b',reviewer:'c'}]}));
 assert.deepEqual(await runRound({workers:[w],signal:AbortSignal.abort()}),[]);
});
