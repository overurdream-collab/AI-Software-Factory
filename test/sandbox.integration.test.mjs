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

 
// Cross-owner integration uses an immutable D revision, never edits D files.
test('project runner with D SQLite, SIGKILL, orphan cleanup and recovery',{skip:!enabled,timeout:120000},async()=>{
 const {mkdtemp,mkdir,writeFile,chmod,rm}=await import('node:fs/promises');
 const {tmpdir}=await import('node:os');
 const {join}=await import('node:path');
 const {pathToFileURL}=await import('node:url');
 const {spawn}=await import('node:child_process');
 const {once}=await import('node:events');
 const {createProjectRunner}=await import('../src/sandbox.mjs');
 const {createReconciler}=await import('../src/reconciler.mjs');
 const revision='8455755657270229ca2db01e32b8f9f764231efb';
 const root=await mkdtemp(join(tmpdir(),'factory-e-'));
 const checkout=join(root,'d'),workspace=join(root,'project'),db=join(root,'state.sqlite');
 const docker=(...args)=>execFileSync('docker',args,{encoding:'utf8',timeout:10000}).trim();
 const git=(...args)=>execFileSync('git',args,{encoding:'utf8',timeout:30000}).trim();
 let store,child,childExit,worktree=false,foreign,live,orphan;
 try{
  git('fetch','--no-tags','--depth=1','origin',revision);
  git('worktree','add','--detach',checkout,revision);worktree=true;
  assert.equal(git('-C',checkout,'rev-parse','HEAD'),revision);
  const moduleUrl=p=>pathToFileURL(join(checkout,'src',p)).href;
  const api=await import(moduleUrl('attempt-store.mjs'));
  const {SQLiteStore}=await import(moduleUrl('sqlite-store.mjs'));
  const {claim}=await import(moduleUrl('leases.mjs'));
  const {enqueue}=await import(moduleUrl('intake.mjs'));
  const imageDigest=docker('image','inspect','--format','{{index .RepoDigests 0}}','node:22-alpine').split('@')[1];
  assert.match(imageDigest,/^sha256:[a-f0-9]{64}$/);
  console.log('D revision='+revision+' image='+imageDigest);
  await mkdir(workspace);await chmod(workspace,0o755);
  await writeFile(join(workspace,'value.js'),'console.log(4)\n',{mode:0o644});
  const limits={timeoutMs:60000,memoryMb:128,cpus:0.5,pids:32,maxOutputBytes:16384};
  store=new SQLiteStore(db);
  await store.transact(s=>enqueue(s,[{id:'crash',role:'dev',goal:'fixture',deps:[]},{id:'live',role:'dev',goal:'control',deps:[]}]));
  const task=await store.transact(s=>claim(s,'dev','crash-worker',Date.now(),20000,3));
  assert.equal(task.id,'crash');
  const control=await store.transact(s=>claim(s,'dev','live-worker',Date.now(),120000,3));
  assert.equal(control.id,'live');
  const liveId=randomUUID();live='factory-project-'+liveId;
  await store.transact(s=>api.recordResource(s,{id:liveId,name:live,kind:'docker',taskId:control.id,attemptId:control.attemptId,leaseToken:control.token,owner:control.worker,createdAt:Date.now()}));
  docker('run','-d','--pull=never','--name',live,'--network=none','--label','factory.runtime=project-v1','--label','factory.task='+control.id,'--label','factory.attempt='+control.attemptId,'node@'+imageDigest,'node','-e','setInterval(()=>{},1000)');
  foreign='factory-project-'+randomUUID();
  docker('run','-d','--pull=never','--name',foreign,'--network=none','node@'+imageDigest,'node','-e','setInterval(()=>{},1000)');
  const childCode=`
   import {readFileSync} from 'node:fs';
   const cfg=JSON.parse(readFileSync(0,'utf8'));
   const {SQLiteStore}=await import(cfg.sqlite);
   const api=await import(cfg.api);
   const {createProjectRunner}=await import(cfg.runner);
   const store=new SQLiteStore(cfg.db);
   await createProjectRunner({...cfg.context,store,resourceApi:api})({workspace:cfg.workspace,limits:cfg.limits,commands:[{cwd:'.',argv:['node','-e',"require('fs').writeFileSync('started','yes');setInterval(()=>{},1000)"]}]});
  `;
  child=spawn(process.execPath,['--input-type=module','-e',childCode],{stdio:['pipe','ignore','ignore']});
  childExit=once(child,'exit');
  child.stdin.end(JSON.stringify({sqlite:moduleUrl('sqlite-store.mjs'),api:moduleUrl('attempt-store.mjs'),runner:new URL('../src/sandbox.mjs',import.meta.url).href,db,workspace,limits,context:{taskId:task.id,attemptId:task.attemptId,leaseToken:task.token,owner:task.worker,imageDigest}}));
  for(let i=0;i<100;i++){
   const resource=await store.transact(s=>(s.resources??[]).find(x=>x.taskId===task.id));
   if(resource){orphan=resource.name;try{if(docker('exec',orphan,'cat','/work/started')==='yes')break;}catch{}}
   if(child.exitCode!==null)throw Error('runner exited before crash');
   await delay(100);
  }
  assert.ok(orphan);
  assert.equal(docker('exec',orphan,'cat','/work/started'),'yes');
  child.kill('SIGKILL');
  assert.equal((await childExit)[1],'SIGKILL');
  assert.equal(docker('inspect','--format','{{.State.Running}}',orphan),'true');
  const reconcile=createReconciler({store,resourceApi:api});
  assert.deepEqual(await reconcile(),[]);
  assert.equal(docker('inspect','--format','{{.State.Running}}',orphan),'true');
  store.close();store=new SQLiteStore(db);
  await delay(Math.max(0,task.expiresAt-Date.now()+50));
  const recovered=await store.transact(s=>claim(s,'dev','replacement',Date.now(),60000,3));
  assert.equal(recovered.id,task.id);assert.notEqual(recovered.attemptId,task.attemptId);
  const cleaned=await createReconciler({store,resourceApi:api})();
  assert.equal(cleaned.length,1);
  assert.throws(()=>docker('inspect',orphan));
  for(const name of [live,foreign])assert.equal(docker('inspect','--format','{{.State.Running}}',name),'true');
  const result=await createProjectRunner({store,resourceApi:api,taskId:recovered.id,attemptId:recovered.attemptId,leaseToken:recovered.token,owner:recovered.worker,imageDigest})({workspace,limits,commands:[{cwd:'.',argv:['node','value.js']},{cwd:'.',argv:['node','-e','process.exit(7)']}]});
  assert.deepEqual(result.commands.map(x=>x.exitCode),[0,7]);assert.equal(result.commands[0].stdout.trim(),'4');
  assert.equal(result.imageDigest,imageDigest);
  const resources=await store.transact(s=>s.resources);
  assert.equal(resources.filter(x=>x.taskId==='crash'&&x.cleanedAt!==undefined).length,2);
  assert.equal(resources.find(x=>x.id===liveId).cleanedAt,undefined);
  console.log('SIGKILL observed; orphan removed after real lease expiry; live and foreign survived; replacement completed');
 }finally{
  if(child&&child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await childExit;}
  for(const name of [orphan,live,foreign])if(name)try{docker('rm','-f',name)}catch{}
  store?.close();
  if(worktree)git('worktree','remove','--force',checkout);
  await rm(root,{recursive:true,force:true});
 }
});
