import {test} from 'node:test';
import assert from 'node:assert/strict';
import {reserveReview,finishReview,releaseReview} from '../src/review-lease.mjs';
test('exclusive reservation, expiry, fencing and independent identity',()=>{
 const s={tasks:[{id:'a',role:'dev',state:'review',worker:'dev',attempts:1}]};
 assert.equal(reserveReview(s,'dev','dev',0,10),null);
 const a=reserveReview(s,'dev','qa1',0,10);
 assert.equal(reserveReview(s,'dev','qa2',9,10),null);
 const b=reserveReview(s,'dev','qa2',10,10);
 assert.throws(()=>finishReview(s,'a',a.reviewToken,11,true,'pass',3));
 releaseReview(s,'a',a.reviewToken);
 assert.equal(finishReview(s,'a',b.reviewToken,11,true,'pass',3),'accepted');
 assert.equal(s.tasks[0].reviewer,'qa2');
});
