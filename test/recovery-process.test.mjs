import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {setTimeout as sleep} from 'node:timers/promises';
import {SQLiteStore} from '../src/sqlite-store.mjs';
import {claim,submit} from '../src/leases.mjs';
import {reserveReview,finishReview} from '../src/review-lease.mjs';
const storeURL=new URL('../src/sqlite-store.mjs',import.meta.url).href;
const leaseURL=new URL('../src/leases.mjs',import.meta.url).href;
const reviewURL=new URL('../src/review-lease.mjs',import.meta.url).href;
function worker(path,owner,phase='execution'){
 const child=spawn(process.execPath,['--input-type=module','-e',`
 import {SQLiteStore} from ${JSON.stringify(storeURL)};
 import {claim} from ${JSON.stringify(leaseURL)};
 import {reserveReview} from ${JSON.stringify(reviewURL)};
 const [path,owner,phase]=process.argv.slice(1);
 const s=new SQLiteStore(path);
 const t=await s.transact(x=>phase==='execution'?claim(x,'dev',owner,Date.now(),3000):reserveReview(x,'dev',owner,Date.now(),3000));
 console.log(JSON.stringify(t));
 if(t)setInterval(()=>{},1000);else s.close();
 `,path,owner,phase],{stdio:['ignore','pipe','inherit']});
 const exited=once(child,'exit');
 const result=new Promise((resolve,reject)=>{let buf='';child.stdout.on('data',b=>{buf+=b;if(buf.includes('\n')){try{resolve(JSON.parse(buf.split('\n')[0]));}catch(e){reject(e);}}});child.on('error',reject);child.on('exit',()=>reject(Error('worker exited before result')));});
 return {child,result,exited};
}
test('real competing processes, SIGKILL, wall-clock expiry and review recovery', {timeout:20000},async()=>{
 const dir=await mkdtemp(join(tmpdir(),'factory-recovery-')),path=join(dir,'state.db');
 const children=[];let s=new SQLiteStore(path);
 try{
 await s.transact(x=>x.tasks.push({id:'a',role:'dev',state:'queued',attempts:0}));
 const a=worker(path,'a'),b=worker(path,'b');children.push(a,b);
 const results=await Promise.all([a.result,b.result]);
 assert.equal(results.filter(Boolean).length,1);
 const winner=results[0]?a:b,old=results.find(Boolean);
 winner.child.kill('SIGKILL');await winner.exited;
 await sleep(Math.max(0,old.expiresAt-Date.now()+20));
 s.close();s=new SQLiteStore(path);
 const fresh=await s.transact(x=>claim(x,'dev','replacement',Date.now(),3000));
 assert.ok(fresh);assert.notEqual(fresh.token,old.token);
 await assert.rejects(s.transact(x=>submit(x,'a',old.token,'stale',Date.now())));
 await s.transact(x=>submit(x,'a',fresh.token,'saved patch',Date.now()));
 const reviewer=worker(path,'reviewer','review');children.push(reviewer);
 const previous=await reviewer.result;assert.equal(previous.artifact,'saved patch');
 reviewer.child.kill('SIGKILL');await reviewer.exited;
 await sleep(Math.max(0,previous.reviewExpiresAt-Date.now()+20));
 const resumed=await s.transact(x=>reserveReview(x,'dev','replacement-review',Date.now(),3000));
 assert.equal(resumed.artifact,'saved patch');assert.equal(resumed.attemptId,fresh.attemptId);
 await assert.rejects(s.transact(x=>finishReview(x,'a',previous.reviewToken,Date.now(),true,'stale',3)));
 await s.transact(x=>finishReview(x,'a',resumed.reviewToken,Date.now(),true,'verified',3));
 const state=await s.transact(x=>structuredClone(x));
 assert.equal(state.tasks[0].state,'accepted');
 assert.deepEqual(state.attempts.map(x=>x.state),['expired','submitted','expired','passed']);
 }finally{for(const w of children){if(w.child.exitCode===null&&w.child.signalCode===null)w.child.kill('SIGKILL');await w.exited;}s.close();await rm(dir,{recursive:true,force:true});}
});
