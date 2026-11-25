import {test} from 'node:test';
import {randomUUID} from 'node:crypto';
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
test('network isolation with reachable positive control',{skip:!enabled,timeout:60000},async()=>{
 const name='factory-net-control-'+randomUUID();
 const network=name+'-network';
 const docker=(...args)=>execFileSync('docker',args,{encoding:'utf8',timeout:10000});
 try{
  docker('network','create',network);
  docker('run','-d','--pull=never','--name',name,'--network',network,'node:22-alpine','node','-e',"require('http').createServer((q,r)=>r.end('control-ok')).listen(8080,'0.0.0.0')");
  const ip=docker('inspect','--format','{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}',name).trim();
  assert.match(ip,/^\d+\.\d+\.\d+\.\d+$/);
  const url='http://'+ip+':8080';
  const probe="fetch("+JSON.stringify(url)+",{signal:AbortSignal.timeout(1500)}).then(async r=>{if(await r.text()!=='control-ok')process.exit(2);console.log('connected')}).catch(()=>process.exit(1))";
  let connected=false;
  for(let i=0;i<5;i++){
   try{connected=docker('run','--rm','--pull=never','--network',network,'node:22-alpine','node','-e',probe).trim()==='connected';if(connected)break;}catch{}
   await delay(200);
  }
  assert.ok(connected,'positive control must reach the same service');
  const source='old';
  const candidate="try{await fetch("+JSON.stringify(url)+",{signal:AbortSignal.timeout(1500)});console.log('connected')}catch{console.log('blocked')}";
  const artifact=await propose({source,goal:'fixture',generate:async()=>candidate});
  assert.equal((await verifyExecutable({source,artifact,expected:'blocked'})).passed,true);
 }finally{
  try{docker('rm','-f',name)}finally{docker('network','rm',network)}
 }
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
