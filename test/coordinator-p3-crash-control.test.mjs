import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {SQLiteStore} from '../src/sqlite-store.mjs';
import {enqueue} from '../src/intake.mjs';
import {claim,submit} from '../src/leases.mjs';

const childSource = `
import {SQLiteStore} from './src/sqlite-store.mjs';
import {claim,submit} from './src/leases.mjs';
const store=new SQLiteStore(process.argv[1]);
const task=await store.transact(s=>claim(s,'dev',process.argv[2],Date.now(),5000,3));
if(!task) throw Error('no task');
process.send({task});
process.on('message',async m=>{
 if(m==='finish'){
  await store.transact(s=>submit(s,task.id,task.token,'control-artifact',Date.now()));
  store.close();process.send({finished:task.id},()=>process.disconnect());
 }
});
`;

test('P3 coordinator control: independent processes, real SIGKILL, durable lease recovery', {timeout:30000,skip:process.platform==='win32'}, async()=>{
 const dir=await mkdtemp(join(tmpdir(),'factory-p3-control-'));
 const db=join(dir,'state.sqlite');
 const children=[];
 let store=new SQLiteStore(db);
 const launch=async name=>{
  const child=spawn(process.execPath,['--input-type=module','-e',childSource,db,name],{stdio:['ignore','ignore','inherit','ipc']});
  children.push(child);
  const exited=once(child,'exit');
  const message=await Promise.race([once(child,'message').then(([m])=>m),exited.then(()=>{throw Error('worker exited before claim')})]);
  return {child,exited,task:message.task};
 };
 try{
  await store.transact(s=>enqueue(s,[{id:'p3-a',role:'dev',goal:'control A',deps:[]},{id:'p3-b',role:'dev',goal:'control B',deps:[]}]));
  const a=await launch('control-a'),b=await launch('control-b');
  assert.notEqual(a.task.id,b.task.id);
  assert.notEqual(a.child.pid,b.child.pid);
  const overlap=await store.transact(s=>s.tasks.filter(t=>t.state==='running').length);
  assert.equal(overlap,2);
  assert.ok(a.child.kill('SIGKILL'));
  assert.equal((await a.exited)[1],'SIGKILL');
  assert.equal(b.child.exitCode,null);
  const done=once(b.child,'message');
  b.child.send('finish');
  assert.equal((await done)[0].finished,b.task.id);
  assert.equal((await b.exited)[0],0);
  store.close();store=new SQLiteStore(db);
  await delay(Math.max(0,a.task.expiresAt-Date.now()+30));
  const recovered=await store.transact(s=>claim(s,'dev','control-replacement',Date.now(),5000,3));
  assert.equal(recovered.id,a.task.id);
  assert.notEqual(recovered.attemptId,a.task.attemptId);
  await assert.rejects(store.transact(s=>submit(s,a.task.id,a.task.token,'stale',Date.now())),/invalid or expired lease/);
  await store.transact(s=>submit(s,recovered.id,recovered.token,'replacement-control-artifact',Date.now()));
  const summary=await store.transact(s=>({tasks:s.tasks.map(({id,state,attempts})=>({id,state,attempts})),attempts:s.attempts.map(({taskId,attemptId,state,startedAt,finishedAt})=>({taskId,attemptId,state,startedAt,finishedAt}))}));
  assert.equal(summary.tasks.filter(t=>t.state==='review').length,2);
  assert.ok(summary.attempts.some(t=>t.attemptId===a.task.attemptId&&t.state==='expired'));
  console.log(JSON.stringify({kind:'process-lease-control-not-live-model',overlap,signal:'SIGKILL',staleRejected:true,...summary}));
 }finally{
  for(const child of children)if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');
  store.close();await rm(dir,{recursive:true,force:true});
 }
});
