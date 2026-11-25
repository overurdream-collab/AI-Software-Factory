import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm,chmod} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawn,execFileSync} from 'node:child_process';
import {once} from 'node:events';
import {setTimeout as sleep} from 'node:timers/promises';
import {SQLiteStore} from '../src/sqlite-store.mjs';
import {claim,submit} from '../src/leases.mjs';
import * as api from '../src/attempt-store.mjs';
const enabled=process.env.FACTORY_DOCKER_TEST==='1';
const E='778efb892c62e45c6c75761028158ab98501dd4d';
test('D/E: kill one executing worker, survivor commits, recover and fence stale output',{skip:!enabled,timeout:120000},async()=>{
 const root=await mkdtemp(join(tmpdir(),'factory-d-dual-')),db=join(root,'state.db'),checkout=join(root,'e');
 const children=[];let store,worktree=false;
 const docker=(...args)=>execFileSync('docker',args,{encoding:'utf8',timeout:10000}).trim();
 const git=(...args)=>execFileSync('git',args,{encoding:'utf8',timeout:30000}).trim();
 const moduleUrl=p=>pathToFileURL(join(checkout,'src',p)).href;
 const ownUrl=p=>new URL('../src/'+p,import.meta.url).href;
 const waitFor=async(fn)=>{for(let i=0;i<150;i++){const x=await fn();if(x)return x;await sleep(100);}throw Error('condition timed out');};
 try{
  git('fetch','--no-tags','--depth=1','origin',E);git('worktree','add','--detach',checkout,E);worktree=true;
  assert.equal(git('-C',checkout,'rev-parse','HEAD'),E);
  const {createProjectRunner}=await import(moduleUrl('sandbox.mjs'));
  const {createReconciler}=await import(moduleUrl('reconciler.mjs'));
  const imageDigest=docker('image','inspect','--format','{{index .RepoDigests 0}}','node:22-alpine').split('@')[1];
  assert.match(imageDigest,/^sha256:[a-f0-9]{64}$/);
  store=new SQLiteStore(db);
  await store.transact(s=>s.tasks.push(...['victim','survivor'].map(id=>({id,role:'dev',state:'queued',attempts:0}))));
  for(const id of ['victim','survivor','replacement']){
   const workspace=join(root,id);await mkdir(workspace);await chmod(workspace,0o755);
   await writeFile(join(workspace,'value.mjs'),"console.log('"+id+"')\n",{mode:0o644});
  }
  const limits={timeoutMs:60000,memoryMb:128,cpus:0.5,pids:32,maxOutputBytes:16384};
  const code=`
   import {readFileSync} from 'node:fs';
   const c=JSON.parse(readFileSync(0,'utf8'));
   const {SQLiteStore}=await import(c.sqlite);const {claim,submit}=await import(c.leases);
   const api=await import(c.api);const {createProjectRunner}=await import(c.runner);
   const store=new SQLiteStore(c.db);
   try{
    const task=await store.transact(s=>claim(s,'dev',c.owner,Date.now(),c.ttl));
    if(task.id!==c.owner)throw Error('unexpected task');
    const run=createProjectRunner({store,resourceApi:api,taskId:task.id,attemptId:task.attemptId,leaseToken:task.token,owner:task.worker,imageDigest:c.imageDigest});
    const script=c.owner==='victim'?"require('fs').writeFileSync('started','yes');setInterval(()=>{},1000)":"const fs=require('fs');fs.writeFileSync('started','yes');const t=setInterval(()=>{if(fs.existsSync('release')){clearInterval(t);console.log('survivor completed')}},100)";
    const result=await run({workspace:c.workspace,limits:c.limits,commands:[{cwd:'.',argv:['node','-e',script]}]});
    if(result.commands[0].exitCode!==0)throw Error('candidate failed');
    await store.transact(s=>submit(s,task.id,task.token,result.commands[0].stdout,Date.now()));
   }finally{store.close();}
  `;
  const start=(owner,ttl)=>{
   const child=spawn(process.execPath,['--input-type=module','-e',code],{stdio:['pipe','ignore','pipe']});
   let stderr='';child.stderr.on('data',b=>{stderr=(stderr+b).slice(-4000);});
   const exit=once(child,'exit').then(([code,signal])=>({code,signal,stderr}));
   children.push({child,exit});
   child.stdin.end(JSON.stringify({owner,ttl,db,workspace:join(root,owner),limits,imageDigest,sqlite:ownUrl('sqlite-store.mjs'),leases:ownUrl('leases.mjs'),api:ownUrl('attempt-store.mjs'),runner:moduleUrl('sandbox.mjs')}));
   return children.at(-1);
  };
  const resource=async id=>store.transact(s=>(s.resources??[]).find(r=>r.taskId===id&&!r.cleanedAt));
  const started=async id=>waitFor(async()=>{const r=await resource(id);if(r)try{if(docker('exec',r.name,'cat','/work/started')==='yes')return r;}catch{}return null;});
  const victim=start('victim',30000);const orphan=await started('victim');
  const survivor=start('survivor',90000);const live=await started('survivor');
  const old=await store.transact(s=>structuredClone(s.tasks.find(t=>t.id==='victim')));
  assert.notEqual(victim.child.pid,survivor.child.pid);
  const killedAt=Date.now();victim.child.kill('SIGKILL');assert.equal((await victim.exit).signal,'SIGKILL');
  assert.equal(docker('inspect','--format','{{.State.Running}}',live.name),'true');
  assert.equal(docker('inspect','--format','{{.State.Running}}',orphan.name),'true');
  const foreign='factory-project-foreign-'+process.pid;
  // Only fixture-owned containers are removed by the harness.
  docker('exec',live.name,'touch','/work/release');
  const survived=await survivor.exit;assert.equal(survived.code,0,survived.stderr);
  const survivorFinishedAt=Date.now();assert.ok(survivorFinishedAt>=killedAt);
  assert.equal(await store.transact(s=>s.tasks.find(t=>t.id==='survivor').state),'review');
  assert.throws(()=>docker('inspect',live.name));
  store.close();store=new SQLiteStore(db);
  await sleep(Math.max(0,old.expiresAt-Date.now()+50));
  const recovered=await store.transact(s=>claim(s,'dev','replacement',Date.now(),60000));
  assert.equal(recovered.id,'victim');assert.notEqual(recovered.attemptId,old.attemptId);
  await assert.rejects(store.transact(s=>submit(s,'victim',old.token,'stale output',Date.now())),/invalid or expired lease/);
  const cleaned=await createReconciler({store,resourceApi:api})();
  assert.deepEqual(cleaned,[orphan.id]);assert.throws(()=>docker('inspect',orphan.name));
  const result=await createProjectRunner({store,resourceApi:api,taskId:recovered.id,attemptId:recovered.attemptId,leaseToken:recovered.token,owner:recovered.worker,imageDigest})({workspace:join(root,'replacement'),limits,commands:[{cwd:'.',argv:['node','value.mjs']}]});
  assert.equal(result.commands[0].exitCode,0);assert.equal(result.commands[0].stdout.trim(),'replacement');
  await store.transact(s=>submit(s,'victim',recovered.token,result.commands[0].stdout,Date.now()));
  const snapshot=await store.transact(s=>structuredClone(s));
  assert.equal(snapshot.tasks.filter(t=>t.state==='review').length,2);
  assert.equal(snapshot.resources.length,3);assert.ok(snapshot.resources.every(r=>r.cleanedAt>=r.createdAt));
  for(const r of snapshot.resources)assert.throws(()=>docker('inspect',r.name));
  console.log('D_DUAL_RECOVERY '+JSON.stringify({E,imageDigest,killedAt,survivorFinishedAt,victimPid:victim.child.pid,survivorPid:survivor.child.pid,oldAttempt:old.attemptId,newAttempt:recovered.attemptId,staleRejected:true,resourcesCleaned:3,reviewTasks:2,generator:'none; deterministic runtime fixture'}));
 }finally{
  for(const w of children)if(w.child.exitCode===null&&w.child.signalCode===null){w.child.kill('SIGKILL');await w.exit;}
  if(store){for(const r of await store.transact(s=>s.resources??[]))if(/^factory-project-[a-f0-9-]{36}$/.test(r.name))try{docker('rm','-f',r.name)}catch{}store.close();}
  if(worktree)git('worktree','remove','--force',checkout);
  await rm(root,{recursive:true,force:true});
 }
});
