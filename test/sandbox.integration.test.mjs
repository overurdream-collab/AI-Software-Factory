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


// Two independent OS workers, real Git repairs and real Docker commands.
// The generator is deliberately deterministic: this proves runtime parallelism,
// not live-model autonomy or F's independent acceptance.
test('two live workers repair different repositories with overlapping candidate execution',{skip:!enabled,timeout:120000},async()=>{
 const {mkdtemp,mkdir,writeFile,readFile,rm}=await import('node:fs/promises');
 const {tmpdir}=await import('node:os');
 const {join}=await import('node:path');
 const {pathToFileURL}=await import('node:url');
 const {spawn}=await import('node:child_process');
 const {once}=await import('node:events');
 const {createHash}=await import('node:crypto');
 const root=await mkdtemp(join(tmpdir(),'factory-parallel-'));
 const db=join(root,'state.sqlite'),children=[],checkouts=[];
 const D='e261a5617422251c7420024da2db81a96c6ad9c1',B='0c5afeda7bd768f939cb061ab45d81e595a43303';
 const git=(...args)=>execFileSync('git',args,{encoding:'utf8',timeout:30000}).trim();
 const docker=(...args)=>execFileSync('docker',args,{encoding:'utf8',timeout:10000}).trim();
 const sha=s=>createHash('sha256').update(s).digest('hex');
 let store;
 try{
  for(const [name,rev] of [['d',D],['b',B]]){
   const dir=join(root,name);
   git('fetch','--no-tags','--depth=1','origin',rev);
   git('worktree','add','--detach',dir,rev);checkouts.push(dir);
   assert.equal(git('-C',dir,'rev-parse','HEAD'),rev);
  }
  const moduleUrl=(agent,file)=>pathToFileURL(join(root,agent,'src',file)).href;
  const {SQLiteStore}=await import(moduleUrl('d','sqlite-store.mjs'));
  const {enqueueSpec}=await import(moduleUrl('d','attempt-store.mjs'));
  store=new SQLiteStore(db);
  const imageDigest=docker('image','inspect','--format','{{index .RepoDigests 0}}','node:22-alpine').split('@')[1];
  assert.match(imageDigest,/^sha256:[a-f0-9]{64}$/);
  const fixtures=[
   {id:'sum',source:'export const calculate=(a,b)=>a-b;\n',fixed:'export const calculate=(a,b)=>a+b;\n',assertions:'assert.equal(calculate(8,3),11);assert.equal(calculate(-2,2),0);'},
   {id:'text',source:'export const calculate=s=>s.toLowerCase();\n',fixed:'export const calculate=s=>s.trim().toLowerCase();\n',assertions:"assert.equal(calculate(' Hi '),'hi');assert.equal(calculate(' WORLD '),'world');"}
  ];
  const configs=[];
  for(const f of fixtures){
   const repo=join(root,'repo-'+f.id),work=join(root,'work-'+f.id);
   await mkdir(repo);await mkdir(work);
   git('-C',repo,'init','-q');
   await writeFile(join(repo,'logic.mjs'),f.source);
   // Trusted operator fixture, not generated code. Record actual process interval.
   await writeFile(join(repo,'check.mjs'),"import assert from 'node:assert/strict';import {calculate} from './logic.mjs';"+f.assertions+"const start=Date.now();await new Promise(r=>setTimeout(r,3000));console.log(JSON.stringify({start,end:Date.now()}));");
   git('-C',repo,'add','.');
   git('-C',repo,'-c','user.name=Factory Fixture','-c','user.email=fixture@example.invalid','commit','-qm','broken fixture');
   const baseCommit=git('-C',repo,'rev-parse','HEAD');
   const spec={version:1,id:f.id,role:'dev',goal:'repair '+f.id,deps:[],repository:'fixture/'+f.id,baseCommit,allowedPaths:['logic.mjs'],testPlanId:'operator-check',limits:{maxAttempts:1,maxReviewAttempts:1,deadlineMs:90000,maxPatchBytes:8192}};
   await store.transact(s=>enqueueSpec(s,spec));
   configs.push({spec,repo,work,fixed:f.fixed,report:join(root,f.id+'.json')});
  }
  const workerCode=`
   import {readFileSync,writeFileSync} from 'node:fs';
   const c=JSON.parse(readFileSync(0,'utf8'));
   const {SQLiteStore}=await import(c.sqlite);
   const api=await import(c.api);
   const {claim,submit}=await import(c.leases);
   const {repairRepository}=await import(c.repair);
   const {stageProject}=await import(c.workspace);
   const {createProjectRunner}=await import(c.runner);
   const store=new SQLiteStore(c.db);
   try{
    const task=await store.transact(s=>claim(s,'dev',c.owner,Date.now(),120000,1));
    const fixture=c.configs.find(x=>x.spec.id===task.id);
    if(!fixture)throw Error('unexpected claim');
    const run=createProjectRunner({store,resourceApi:api,taskId:task.id,attemptId:task.attemptId,leaseToken:task.token,owner:task.worker,imageDigest:c.imageDigest});
    const phases=[],paths=[];
    const artifact=await repairRepository({spec:fixture.spec,attemptId:task.attemptId,repositoryPath:fixture.repo,root:fixture.work,generate:async()=>fixture.fixed,testPlan:{id:'operator-check',commands:[{cwd:'.',argv:['node','check.mjs']}]},runnerLimits:{timeoutMs:30000,memoryMb:128,cpus:0.5,pids:32,maxOutputBytes:16384},
     runProject:async input=>{const stage=await stageProject(input.workspace,input.signal);paths.push({checkout:input.workspace,stage:stage.workspace});try{return await run({...input,workspace:stage.workspace});}finally{await stage.cleanup();}},
     onEvidence:async e=>phases.push(e)});
    await store.transact(s=>submit(s,task.id,task.token,artifact,Date.now()));
    writeFileSync(fixture.report,JSON.stringify({pid:process.pid,worker:c.owner,taskId:task.id,attemptId:task.attemptId,artifact:JSON.parse(artifact),phases,paths}));
   }finally{store.close();}
  `;
  for(const owner of ['worker-01','worker-02']){
   const child=spawn(process.execPath,['--input-type=module','-e',workerCode],{stdio:['pipe','ignore','pipe']});
   let stderr='';child.stderr.on('data',b=>{stderr=(stderr+b.toString()).slice(-4000);});
   const exit=once(child,'exit').then(([code,signal])=>({code,signal,stderr}));
   children.push({child,exit});
   child.stdin.end(JSON.stringify({owner,configs,db,imageDigest,sqlite:moduleUrl('d','sqlite-store.mjs'),api:moduleUrl('d','attempt-store.mjs'),leases:moduleUrl('d','leases.mjs'),repair:moduleUrl('b','repository-worker.mjs'),workspace:moduleUrl('b','workspace.mjs'),runner:new URL('../src/sandbox.mjs',import.meta.url).href}));
  }
  const exits=await Promise.all(children.map(x=>x.exit));
  assert.deepEqual(exits.map(x=>x.code),[0,0],JSON.stringify(exits));
  const reports=await Promise.all(configs.map(async x=>JSON.parse(await readFile(x.report,'utf8'))));
  assert.notEqual(reports[0].pid,reports[1].pid);
  assert.notEqual(reports[0].attemptId,reports[1].attemptId);
  assert.notEqual(reports[0].paths[0].checkout,reports[1].paths[0].checkout);
  const stages=reports.flatMap(r=>r.paths.map(x=>x.stage));
  assert.equal(new Set(stages).size,4);
  const intervals=[];
  for(const [i,report] of reports.entries()){
   const f=fixtures[i],cfg=configs[i];
   assert.equal(report.taskId,f.id);
   assert.deepEqual(report.phases.map(x=>x.phase),['baseline','candidate-1']);
   const [red,green]=report.phases.map(x=>x.result.commands[0]);
   assert.equal(red.exitCode,1);assert.match(red.stderr,/AssertionError/);assert.equal(green.exitCode,0);
   assert.equal(report.phases[1].result.imageDigest,imageDigest);
   const interval=JSON.parse(green.stdout.trim());assert.ok(interval.end-interval.start>=2900);
   intervals.push(interval);
   assert.deepEqual(report.artifact.changedPaths,['logic.mjs']);
   assert.equal(report.artifact.patchSha256,sha(report.artifact.patch));
   assert.equal(report.artifact.baseCommit,cfg.spec.baseCommit);
   // Independently apply patch to pristine repository and confirm exact tree.
   const patchPath=join(root,f.id+'.patch');await writeFile(patchPath,report.artifact.patch);
   git('-C',cfg.repo,'apply','--index',patchPath);
   assert.equal(git('-C',cfg.repo,'write-tree'),report.artifact.candidateTree);
   assert.equal(await readFile(join(cfg.repo,'logic.mjs'),'utf8'),f.fixed);
  }
  assert.notEqual(reports[0].artifact.patchSha256,reports[1].artifact.patchSha256);
  const overlapMs=Math.min(...intervals.map(x=>x.end))-Math.max(...intervals.map(x=>x.start));
  assert.ok(overlapMs>0,'actual candidate commands must overlap');
  const state=await store.transact(s=>s);
  assert.equal(state.tasks.filter(t=>t.state==='review').length,2);
  assert.equal(state.resources.length,4);
  for(const resource of state.resources){assert.ok(resource.cleanedAt>=resource.createdAt);assert.throws(()=>docker('inspect',resource.name));}
  console.log('PARALLEL_EVIDENCE '+JSON.stringify({version:1,D,B,imageDigest,generator:'deterministic-fixture',overlapMs,workers:reports.map((x,i)=>({worker:x.worker,pid:x.pid,taskId:x.taskId,attemptId:x.attemptId,workspace:x.paths[0].checkout,baselineExit:1,candidateExit:0,patchSha256:x.artifact.patchSha256,candidateTree:x.artifact.candidateTree,...intervals[i]})),resourcesCleaned:4}));
 }finally{
  for(const x of children)if(x.child.exitCode===null&&x.child.signalCode===null){x.child.kill('SIGKILL');await x.exit;}
  if(store){
   const resources=await store.transact(s=>s.resources??[]);
   for(const r of resources)if(/^factory-project-[a-f0-9-]{36}$/.test(r.name))try{docker('rm','-f',r.name)}catch{}
   store.close();
  }
  for(const dir of checkouts)git('worktree','remove','--force',dir);
  await rm(root,{recursive:true,force:true});
 }
});
