import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createReconciler} from '../src/reconciler.mjs';
import {withHeartbeat} from '../src/heartbeat.mjs';
import {runDaemon} from '../src/daemon.mjs';
test('reconciler only removes matching expired container ID',async()=>{
 const name='factory-project-12345678-1234-1234-1234-123456789abc';
 const r={id:'r',kind:'docker',name,taskId:'t',attemptId:'a'};
 const calls=[],cleaned=[];
 const store={transact:async f=>f({})};
 const api={listReclaimableResources:()=>[r],markResourceCleaned:(_,id)=>cleaned.push(id)};
 let valid=false;
 const docker=async args=>{calls.push(args);return {code:0,stdout:JSON.stringify([{Id:'a'.repeat(64),Name:'/'+name,Config:{Labels:{'factory.runtime':'project-v1','factory.task':'t','factory.attempt':valid?'a':'other'}}}]),stderr:''};};
 const reconcile=createReconciler({store,resourceApi:api,docker});
 assert.deepEqual(await reconcile(),[]);
 valid=true;
 assert.deepEqual(await reconcile(),['r']);
 assert.deepEqual(calls.at(-1),['rm','-f','a'.repeat(64)]);
 assert.deepEqual(cleaned,['r']);
});
test('heartbeat forwards external cancellation',async()=>{
 const c=new AbortController();
 const p=withHeartbeat({store:{transact:async()=>{}},task:{id:'t'},owner:'w',clock:Date.now,ttl:1000,signal:c.signal,operation:async(_,signal)=>{await new Promise(resolve=>signal.addEventListener('abort',resolve,{once:true}));signal.throwIfAborted();}});
 await Promise.resolve();c.abort(Error('stop'));
 await assert.rejects(p,/stop/);
});
test('daemon backs off after reconciliation failure and stops',async()=>{
 const c=new AbortController(),reports=[];
 await runDaemon({store:{},workers:[],signal:c.signal,idleMs:1,maxBackoffMs:4,reconcile:async()=>{throw Error('fixture');},onProgress:r=>{reports.push(r);if(reports.length===3)c.abort();}});
 assert.deepEqual(reports.map(r=>r.delay),[2,4,4]);
});
