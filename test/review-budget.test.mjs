import {test} from 'node:test';
import assert from 'node:assert/strict';
import {reserveReview,failReview,finishReview} from '../src/review-lease.mjs';
import {claim,failExecution} from '../src/leases.mjs';
test('review budget survives expiry and changed configuration',()=>{
 const s={tasks:[{id:'a',role:'dev',state:'review',worker:'dev',attempts:1}]};
 const a=reserveReview(s,'dev','qa',0,10,undefined,2);
 const b=reserveReview(s,'dev','qa',10,10,undefined,99);
 assert.equal(b.reviewLimit,2);
 assert.equal(failReview(s,'a',a.reviewToken,11),false);
 assert.equal(failReview(s,'a',b.reviewToken,11),true);
 assert.equal(s.tasks[0].state,'blocked');
 assert.equal(reserveReview(s,'dev','qa',12,10),null);
 assert.throws(()=>finishReview(s,'a',b.reviewToken,12,true,'pass',3));
});
test('expired final review is blocked rather than reserved again',()=>{
 const s={tasks:[{id:'a',role:'dev',state:'review',worker:'dev',attempts:1}]};
 reserveReview(s,'dev','qa',0,10,undefined,1);
 assert.equal(reserveReview(s,'dev','qa',10,10,undefined,9),null);
 assert.equal(s.tasks[0].state,'blocked');
});
test('execution failure immediately releases valid lease and fences stale owner',()=>{
 const s={tasks:[{id:'a',role:'dev',state:'queued',attempts:0}]};
 const a=claim(s,'dev','w',0,10,2);
 assert.equal(failExecution(s,'a',a.token,1),true);
 const b=claim(s,'dev','w2',2,10,99);
 assert.equal(failExecution(s,'a',a.token,3),false);
 assert.equal(failExecution(s,'a',b.token,3),true);
 assert.equal(s.tasks[0].state,'blocked');
});
