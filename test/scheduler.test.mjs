import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Scheduler} from '../src/scheduler.mjs';
const tasks=[{id:'a',role:'backend',goal:'implement'},{id:'b',role:'qa',goal:'verify',deps:['a']}];
test('dependencies wait for independent acceptance',()=>{
 const s=new Scheduler(tasks);
 assert.equal(s.claim('qa','q'),null);
 assert.equal(s.claim('backend','w').id,'a');
 assert.equal(s.claim('backend','other'),null);
 s.submit('a','w','commit');
 assert.throws(()=>s.review('a','w',true,'test'));
 assert.throws(()=>s.review('a','q',true,''));
 s.review('a','q',true,'test evidence');
 assert.equal(s.claim('qa','q').id,'b');
});
test('bounded retries',()=>{
 const s=new Scheduler(tasks,2);
 for(let i=0;i<2;i++){s.claim('backend','w');s.submit('a','w','patch');s.review('a','q',false,'failed');}
 assert.equal(s.snapshot()[0].state,'blocked');
 assert.equal(s.claim('backend','w'),null);
 assert.equal(s.claim('qa','q'),null);
});
test('invalid dependencies and unauthorized submission',()=>{
 assert.throws(()=>new Scheduler([{id:'a',role:'x',goal:'x',deps:['a']}]));
 const s=new Scheduler(tasks);s.claim('backend','w');
 assert.throws(()=>s.submit('a','other','patch'));
});
