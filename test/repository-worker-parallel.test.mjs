import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {performance} from 'node:perf_hooks';
import {repairRepository} from '../src/repository-worker.mjs';
import {git,createWorkspace} from '../src/workspace.mjs';

test('two real repair workers overlap on distinct bugs and clean workspaces (stub generator, host fixture)',{timeout:60000},async t=>{
 const dir=await mkdtemp(join(tmpdir(),'b-parallel-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const repo=join(dir,'repo'),root=join(dir,'work');await mkdir(repo);await mkdir(root);
 await git(repo,['init','-q']);await git(repo,['config','user.name','Fixture']);await git(repo,['config','user.email','fixture@example.invalid']);
 const cases=[
 {id:'addition',file:'add.mjs',bad:'export const calc=(a,b)=>a-b;\n',good:'export const calc=(a,b)=>a+b;\n',expected:7,zero:5},
 {id:'discount',file:'discount.mjs',bad:'export const calc=(a,b)=>a+b;\n',good:'export const calc=(a,b)=>a-b;\n',expected:3,zero:5}];
 for(const c of cases){
  await writeFile(join(repo,c.file),c.bad);
  await writeFile(join(repo,c.id+'.test.mjs'),"import {test} from 'node:test';import assert from 'node:assert/strict';import {calc} from './"+c.file+"';test('bug',()=>assert.equal(calc(5,2),"+c.expected+"));test('regression',()=>assert.equal(calc(5,0),"+c.zero+"));\n");
 }
 await git(repo,['add','.']);await git(repo,['commit','-qm','two bugs']);
 const baseCommit=(await git(repo,['rev-parse','HEAD'])).trim(),runs=[],workspaces=new Map();
 // A trusted fixture process holds both baseline commands at a rendezvous
 // until both are actually spawned. No model-generated code is executed.
 let release;const gate=new Promise(r=>release=r);let arrivals=0;
 const runner=id=>async({workspace,commands,signal})=>{
  if(workspaces.has(id))assert.equal(workspaces.get(id),workspace);else workspaces.set(id,workspace);
  const c=commands[0],phase=runs.some(x=>x.id===id)?'candidate':'baseline';
  const child=spawn(c.argv[0],c.argv.slice(1),{cwd:workspace,signal,env:{PATH:process.env.PATH},stdio:['pipe','pipe','pipe']});
  const record={id,phase,pid:child.pid,startedMs:performance.now()};runs.push(record);
  let stdout='',stderr='';child.stdout.on('data',x=>stdout+=x);child.stderr.on('data',x=>stderr+=x);
  const done=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',exitCode=>{record.finishedMs=performance.now();record.exitCode=exitCode;resolve({...c,exitCode,stdout,stderr});});});
  if(phase==='baseline'){if(++arrivals===2)release();await Promise.race([gate, new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}))]);}
  child.stdin.end('go');
  return {runtime:'host-fixture-not-docker',imageDigest:null,commands:[await done]};
 };
 const results=await Promise.all(cases.map(c=>repairRepository({
  spec:{version:1,id:c.id,role:'dev',repository:'local/fixture',baseCommit,goal:'fix '+c.id,allowedPaths:[c.file],testPlanId:c.id,limits:{maxAttempts:1,maxPatchBytes:4096,deadlineMs:30000}},
  attemptId:'attempt-'+c.id,repositoryPath:repo,root,generate:async()=>c.good,runProject:runner(c.id),
  testPlan:{id:c.id,commands:[{argv:[process.execPath,'--input-type=module','-e',"await new Promise(r=>process.stdin.once('data',r));const {spawnSync}=await import('node:child_process');const x=spawnSync(process.execPath,['--test',"+JSON.stringify(c.id+'.test.mjs')+"],{stdio:'inherit'});process.exit(x.status??1)"],cwd:'.'}]},runnerLimits:{timeoutMs:5000}
 })));
 const base=runs.filter(x=>x.phase==='baseline'),overlapMs=Math.min(...base.map(x=>x.finishedMs))-Math.max(...base.map(x=>x.startedMs));
 assert.equal(base.length,2);assert.ok(overlapMs>0);assert.notEqual(base[0].pid,base[1].pid);assert.equal(new Set(workspaces.values()).size,2);
 const artifacts=results.map(JSON.parse);assert.notEqual(artifacts[0].candidateTree,artifacts[1].candidateTree);assert.notEqual(artifacts[0].patchSha256,artifacts[1].patchSha256);
 for(let i=0;i<cases.length;i++){
  const c=cases[i],a=artifacts[i];assert.deepEqual(a.changedPaths,[c.file]);assert.deepEqual(runs.filter(x=>x.id===c.id).map(x=>x.exitCode),[1,0]);
  const w=await createWorkspace({root,repositoryPath:repo,baseCommit});
  try{await writeFile(join(w.workspace,'patch.diff'),a.patch);await git(w.workspace,['apply','--index','patch.diff']);assert.equal((await git(w.workspace,['write-tree'])).trim(),a.candidateTree);assert.equal(await readFile(join(w.workspace,c.file),'utf8'),c.good);const other=cases[1-i];assert.equal(await readFile(join(w.workspace,other.file),'utf8'),other.bad);}finally{await w.cleanup();}
  assert.equal(await readFile(join(repo,c.file),'utf8'),c.bad);
 }
 assert.deepEqual(await readdir(root),[]);
 t.diagnostic(JSON.stringify({kind:'host-fixture-stub-generator',clock:'monotonic-ms',baseCommit,overlapMs,runs,distinctWorkspaces:2,artifacts:artifacts.map(({taskId,patchSha256,candidateTree,changedPaths})=>({taskId,patchSha256,candidateTree,changedPaths}))}));
});
