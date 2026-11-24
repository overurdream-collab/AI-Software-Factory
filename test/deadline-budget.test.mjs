import {test} from 'node:test';
import assert from 'node:assert/strict';
import {claim,submit,review} from '../src/leases.mjs';
import {withHeartbeat} from '../src/heartbeat.mjs';
test('noncooperative asynchronous adapter cannot return a late accepted result',async()=>{
 const s={tasks:[{id:'a',role:'dev',state:'queued',attempts:0}]};
 const task=claim(s,'dev','worker',0,1000);
 let signal;
 await assert.rejects(withHeartbeat({store:{transact:async f=>f(s)},task,owner:'worker',clock:()=>0,ttl:1000,deadlineMs:10,operation:(_,sig)=>{signal=sig;return new Promise(()=>{});}}),/deadline exceeded/);
 assert.equal(signal.aborted,true);
});
test('attempt limit persists across restart and configuration changes',()=>{
 let s={tasks:[{id:'a',role:'dev',state:'queued',attempts:0}]};
 const a=claim(s,'dev','worker',0,10,1);
 s=JSON.parse(JSON.stringify(s));
 assert.equal(claim(s,'dev','other',10,10,99),null);
 assert.equal(s.tasks[0].state,'blocked');
 assert.equal(a.attemptLimit,1);
});
test('review rejection respects original attempt budget',()=>{
 const s={tasks:[{id:'a',role:'dev',state:'queued',attempts:0}]};
 const a=claim(s,'dev','worker',0,10,1);
 submit(s,'a',a.token,'candidate',1);
 review(s,'a','qa',false,'failed',99);
 assert.equal(s.tasks[0].state,'blocked');
});
