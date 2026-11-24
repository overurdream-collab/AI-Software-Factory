import {test} from 'node:test';
import assert from 'node:assert/strict';
import {claim,submit} from '../src/leases.mjs';
import {reserveReview,finishReview} from '../src/review-lease.mjs';
import {renew,withHeartbeat} from '../src/heartbeat.mjs';
test('execution and review renewals fence wrong owners and expired tokens',()=>{
 const s={tasks:[{id:'a',role:'dev',state:'queued',attempts:0}]};
 const a=claim(s,'dev','worker',0,10);
 assert.throws(()=>renew(s,{id:'a',token:a.token,owner:'other',now:5,ttl:10}));
 assert.equal(renew(s,{id:'a',token:a.token,owner:'worker',now:5,ttl:10}),15);
 assert.equal(claim(s,'dev','other',11,10),null);
 submit(s,'a',a.token,'artifact',14);
 const r=reserveReview(s,'dev','qa',14,10);
 assert.equal(renew(s,{id:'a',token:r.reviewToken,owner:'qa',now:20,ttl:10,review:true}),30);
 assert.throws(()=>renew(s,{id:'a',token:r.reviewToken,owner:'qa',now:30,ttl:10,review:true}));
 const next=reserveReview(s,'dev','qa2',30,10);
 assert.throws(()=>finishReview(s,'a',r.reviewToken,31,true,'old',3));
 assert.equal(finishReview(s,'a',next.reviewToken,31,true,'new',3),'accepted');
});
test('heartbeat wrapper renews during adapter and stops after completion',async()=>{
 const s={tasks:[{id:'a',role:'dev',state:'queued',attempts:0}]};
 const a=claim(s,'dev','worker',0,30);
 let calls=0;
 const store={transact:async fn=>{calls++;return fn(s);}};
 await withHeartbeat({store,task:a,owner:'worker',clock:()=>20,ttl:30,operation:async()=>{await new Promise(r=>setTimeout(r,45));return 'ok';}});
 assert.ok(calls>0);assert.equal(s.tasks[0].expiresAt,50);
 const count=calls;await new Promise(r=>setTimeout(r,25));assert.equal(calls,count);
});
