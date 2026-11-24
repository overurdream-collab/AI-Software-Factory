import {test} from 'node:test';
import assert from 'node:assert/strict';
import {enqueue} from '../src/intake.mjs';
import {claim,submit,review} from '../src/leases.mjs';
test('idempotent intake preserves progress and dependency order',()=>{
 const s={tasks:[]};const defs=[{id:'b',role:'qa',goal:'check',deps:['a']},{id:'a',role:'dev',goal:'fix'}];
 assert.equal(enqueue(s,defs),2);
 assert.equal(claim(s,'qa','q',1),null);
 const a=claim(s,'dev','d',1);
 submit(s,'a',a.token,'artifact',2);review(s,'a','r',true,'evidence');
 assert.equal(enqueue(s,defs),0);
 assert.equal(s.tasks.find(t=>t.id==='a').state,'accepted');
 assert.equal(claim(s,'qa','q',3).id,'b');
});
test('reject invalid graph and conflicting replay atomically',()=>{
 const s={tasks:[]};
 assert.throws(()=>enqueue(s,[{id:'a',role:'dev',goal:'x',deps:['b']},{id:'b',role:'dev',goal:'y',deps:['a']}]));
 assert.equal(s.tasks.length,0);
 assert.throws(()=>enqueue(s,[{id:'a',role:'dev',goal:'x',deps:['missing']}]));
 enqueue(s,[{id:'a',role:'dev',goal:'x'}]);
 assert.throws(()=>enqueue(s,[{id:'b',role:'dev',goal:'y'},{id:'a',role:'dev',goal:'changed'}]));
 assert.equal(s.tasks.length,1);
});
