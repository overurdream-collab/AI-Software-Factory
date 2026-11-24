import {test} from 'node:test';
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
