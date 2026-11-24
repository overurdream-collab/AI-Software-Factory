import {test} from 'node:test';
import assert from 'node:assert/strict';
import {propose,verifyPatch,digest} from '../src/patch-adapter.mjs';
import {tick} from '../src/worker-loop.mjs';
import {DurableStore} from '../src/durable-store.mjs';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
test('real file modification, independent content check, retry and evidence',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'factory-integration-'));
 try{
 const store=new DurableStore(join(dir,'state.json'));
 const source='export const port = 0;';
 const goal='set port to 8080';
 await store.transact(s=>s.tasks.push({id:'fix',role:'dev',state:'queued',attempts:0,goal}));
 const args={store,role:'dev',worker:'dev',reviewer:'qa',
 execute:t=>propose({source,goal,generate:async()=>t.attempts===1?'export const port = 80;':'export const port = 8080;'}),
 verify:t=>verifyPatch({source,artifact:t.artifact,check:async candidate=>candidate==='export const port = 8080;'})};
 assert.equal((await tick(args)).state,'queued');
 assert.equal((await tick(args)).state,'accepted');
 const task=await store.transact(s=>s.tasks[0]);
 assert.equal(JSON.parse(task.evidence).sha,digest('export const port = 8080;'));
 assert.equal(task.attempts,2);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('reject tampered candidate and mismatched base',async()=>{
 const artifact=await propose({source:'old',goal:'fix',generate:async()=>'new'});
 await assert.rejects(verifyPatch({source:'different',artifact,check:()=>true}));
 const p=JSON.parse(artifact);p.candidate='tampered';
 await assert.rejects(verifyPatch({source:'old',artifact:JSON.stringify(p),check:()=>true}));
});
