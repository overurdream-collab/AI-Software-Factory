import {test} from 'node:test';
import {execFileSync} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import assert from 'node:assert/strict';
import {propose} from '../src/patch-adapter.mjs';
import {verifyExecutable} from '../src/sandbox.mjs';
const enabled=process.env.FACTORY_DOCKER_TEST==='1';
test('execute candidate in Docker and independently reject wrong output',{skip:!enabled},async()=>{
 const source='console.log(0)';
 for(const [candidate,passed] of [['console.log(2+2)',true],['console.log(3)',false]]){
  const artifact=await propose({source,goal:'print four',generate:async()=>candidate});
  const result=await verifyExecutable({source,artifact,expected:'4'});
  assert.equal(result.passed,passed);
  assert.equal(JSON.parse(result.evidence).sha,JSON.parse(artifact).sha);
 }
});
test('reject network access in isolated runtime',{skip:!enabled},async()=>{
 const source='old';
 const artifact=await propose({source,goal:'fixture',generate:async()=>`try { await fetch('http://192.0.2.1',{signal:AbortSignal.timeout(1000)}); console.log('connected'); } catch { console.log('blocked'); }`});
 const result=await verifyExecutable({source,artifact,expected:'blocked'});
 assert.equal(result.passed,true);
});

test('abort running Docker candidate and verify container removal',{skip:!enabled,timeout:45000},async()=>{
 const source='old';
 const artifact=await propose({source,goal:'cancellation fixture',generate:async()=> 'setInterval(()=>{},1000)'});
 const names=()=>execFileSync('docker',['ps','-a','--filter','name=factory-','--format','{{.Names}}'],{encoding:'utf8',timeout:5000}).trim().split('\n').filter(Boolean);
 const before=new Set(names());
 const controller=new AbortController();
 const pending=verifyExecutable({source,artifact,expected:'never',timeoutMs:30000,signal:controller.signal});
 // Attach rejection handler immediately, including infrastructure failures.
 const outcome=pending.then(value=>({value}),error=>({error}));
 let name;
 try{
  for(let i=0;i<80;i++){
   const running=execFileSync('docker',['ps','--filter','name=factory-','--format','{{.Names}}'],{encoding:'utf8',timeout:5000}).trim().split('\n');
   name=running.find(n=>n&&!before.has(n));
   if(name)break;
   await delay(100);
  }
  assert.ok(name,'candidate must actually start before cancellation');
  controller.abort(new Error('integration lease lost'));
  const result=await outcome;
  assert.match(String(result.error),/integration lease lost/);
  assert.ok(!names().includes(name),'cancelled container must be removed');
 }finally{
  controller.abort();
  await outcome;
 }
});
