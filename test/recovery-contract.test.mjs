import {test} from 'node:test';
import assert from 'node:assert/strict';
import {enqueueSpec,recordResource,listReclaimableResources,markResourceCleaned,getDelivery,reserveDelivery,finishDelivery} from '../src/attempt-store.mjs';
import {claim,submit} from '../src/leases.mjs';
import {reserveReview,finishReview} from '../src/review-lease.mjs';
const spec={version:1,id:'a',role:'dev',goal:'fix',deps:[],repository:'owner/repo',baseCommit:'a'.repeat(40),allowedPaths:['src/a.js'],testPlanId:'unit',limits:{maxAttempts:2,maxReviewAttempts:2,deadlineMs:1000,maxPatchBytes:1024}};
test('spec replay is idempotent and changing authorization is rejected',()=>{
 const s={tasks:[]};assert.equal(enqueueSpec(s,spec),1);
 const t=claim(s,'dev','worker',10,10,99);assert.equal(t.attemptLimit,2);
 assert.equal(enqueueSpec(s,spec),0);assert.equal(s.tasks[0].token,t.token);
 assert.throws(()=>enqueueSpec(s,{...spec,allowedPaths:['src/b.js']}));
 assert.throws(()=>enqueueSpec(s,{...spec,id:'b',allowedPaths:['../escape']}));
});
test('resource reclaim respects live review lease and rejects stale registration',()=>{
 const s={tasks:[]};enqueueSpec(s,spec);
 const t=claim(s,'dev','worker',10,10);
 const r={id:'r1',taskId:'a',attemptId:t.attemptId,leaseToken:t.token,owner:'worker',kind:'docker',name:'factory-r1',createdAt:11};
 recordResource(s,r);assert.deepEqual(listReclaimableResources(s,12),[]);
 submit(s,'a',t.token,'patch',13);
 const v=reserveReview(s,'dev','qa',14,10);
 const q={...r,id:'r2',name:'factory-r2',leaseToken:v.reviewToken,owner:'qa',createdAt:15};
 recordResource(s,q);
 assert.deepEqual(listReclaimableResources(s,21).map(x=>x.id),['r1']);
 const q2={...q,id:'r4',name:'factory-r4'};recordResource(s,q2);
 markResourceCleaned(s,'r4',21);assert.equal(s.resources.find(x=>x.id==='r4').cleanedAt,21);
 markResourceCleaned(s,'r1',21);
 assert.throws(()=>recordResource(s,{...r,id:'r3',name:'factory-r3',createdAt:21}));
 finishReview(s,'a',v.reviewToken,22,true,'verified');
 assert.deepEqual(listReclaimableResources(s,23).map(x=>x.id),['r2']);
});
test('delivery lease fencing preserves known remote identifiers across retries',()=>{
 const s={tasks:[]}, key='owner/repo:a', sha='b'.repeat(40);
 const a=reserveDelivery(s,key,'one',10,10);
 assert.equal(reserveDelivery(s,key,'two',11,10),null);
 finishDelivery(s,key,a.token,12,{state:'pending',branch:'factory/a',commitSha:sha,prNumber:7});
 const b=reserveDelivery(s,key,'two',13,10);
 const c=reserveDelivery(s,key,'three',23,10);
 assert.throws(()=>finishDelivery(s,key,b.token,24,{state:'pending'}));
 assert.equal(getDelivery(s,key).prNumber,7);
 assert.throws(()=>finishDelivery(s,key,c.token,24,{state:'delivered',commitSha:sha,checkedCommit:'c'.repeat(40)}));
 finishDelivery(s,key,c.token,24,{state:'delivered',commitSha:sha,checkedCommit:sha,prNumber:7,prUrl:'https://github.com/owner/repo/pull/7',checkRunIds:[1]});
 assert.equal(reserveDelivery(s,key,'four',25,10),null);
 assert.equal(getDelivery(s,key).state,'delivered');
});

test('C issue identifier preserves original identity and dependency graph',()=>{
 const s={tasks:[]};const first={...spec,id:'owner/repo#7'};
 const second={...spec,id:'owner/repo#8',deps:[first.id]};
 assert.equal(enqueueSpec(s,first),1);assert.equal(enqueueSpec(s,second),1);
 assert.equal(enqueueSpec(s,first),0);
 const t=claim(s,'dev','worker',10,10);assert.equal(t.id,first.id);
 assert.equal(claim(s,'dev','other',11,10),null);
 submit(s,t.id,t.token,'patch',12);const v=reserveReview(s,'dev','qa',13,10);
 finishReview(s,t.id,v.reviewToken,14,true,'verified');
 assert.equal(claim(s,'dev','other',15,10).id,second.id);
 assert.throws(()=>enqueueSpec(s,{...spec,id:'other/repo#9'}));
});

test('delivery failure is archived on retry and never leaks into delivered status',()=>{
 const s={tasks:[]},key='owner/repo:history',sha='c'.repeat(40);
 const a=reserveDelivery(s,key,'one',10,10);
 finishDelivery(s,key,a.token,11,{state:'pending',failure:'CI pending',branch:'factory/history'});
 assert.equal(getDelivery(s,key).failure,'CI pending');
 const b=reserveDelivery(s,key,'two',12,10);
 assert.equal(Object.hasOwn(getDelivery(s,key),'failure'),false);
 assert.deepEqual(getDelivery(s,key).failureHistory,[{reason:'CI pending',at:11,state:'pending'}]);
 const c=reserveDelivery(s,key,'three',22,10);
 assert.throws(()=>finishDelivery(s,key,b.token,23,{state:'pending',failure:'stale'}));
 finishDelivery(s,key,c.token,23,{state:'pending',failure:'network error'});
 const d=reserveDelivery(s,key,'four',24,10);
 const result={state:'delivered',commitSha:sha,checkedCommit:sha,prNumber:7,prUrl:'https://github.com/owner/repo/pull/7',checkRunIds:[1]};
 assert.throws(()=>finishDelivery(s,key,d.token,25,{...result,failure:'contradiction'}));
 finishDelivery(s,key,d.token,25,result);
 const done=getDelivery(s,key);
 assert.equal(done.state,'delivered');
 assert.equal(Object.hasOwn(done,'failure'),false);
 assert.equal(Object.hasOwn(done,'failureAt'),false);
 assert.deepEqual(done.failureHistory.map(x=>x.reason),['CI pending','delivery-lease-expired','network error']);
 assert.equal(done.branch,'factory/history');
});
test('legacy delivered snapshots hide obsolete failure without losing its reason',()=>{
 const s={tasks:[],deliveries:[{key:'legacy',state:'delivered',failure:'old failure'}]};
 const d=getDelivery(s,'legacy');
 assert.equal(Object.hasOwn(d,'failure'),false);
 assert.deepEqual(d.failureHistory,[{reason:'old failure',at:null,state:'delivered'}]);
 assert.equal(s.deliveries[0].failure,'old failure');
});
