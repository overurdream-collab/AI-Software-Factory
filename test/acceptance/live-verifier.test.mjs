import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,lstat,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
import {createRepositoryArtifactVerifier,P2_TEST_PLAN} from '../../scripts/acceptance.mjs';
import {reserveReview} from '../../src/review-lease.mjs';
import {claim} from '../../src/leases.mjs';
const exec=promisify(execFile),hash=s=>createHash('sha256').update(s).digest('hex');
const SOURCE='fixtures/p2-clamp/clamp.mjs',imageDigest='sha256:'+'a'.repeat(64);
const git=async(cwd,args)=>(await exec('git',['-c','core.hooksPath=/dev/null',...args],{cwd,env:{PATH:process.env.PATH,HOME:'/nonexistent',GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1'}})).stdout;
const tap=({total=7,passed=7,failed=0,skipped=0,todo=0}={})=>'TAP version 13\n'+Array.from({length:total},(_,i)=>`${i<passed?'ok':'not ok'} ${i+1} - fixed-control-${i}`).join('\n')+`\n1..${total}\n# tests ${total}\n# suites 0\n# pass ${passed}\n# fail ${failed}\n# cancelled 0\n# skipped ${skipped}\n# todo ${todo}\n`;
async function fixture(fn){
 const dir=await mkdtemp(join(tmpdir(),'f-acceptance-unit-'));
 try{
  const repo=join(dir,'repo'),root=join(dir,'work'),logs=join(dir,'logs');
  await mkdir(join(repo,'fixtures/p2-clamp'),{recursive:true});await mkdir(root);
  await git(repo,['init','-q']);
  await writeFile(join(repo,SOURCE),'export const clamp = (value,min,max) => Math.min(value,max);\n');
  await git(repo,['add','.']);await git(repo,['-c','user.name=F control','-c','user.email=f@example.test','commit','-qm','fixed buggy control']);
  const base=(await git(repo,['rev-parse','HEAD'])).trim();
  await writeFile(join(repo,SOURCE),'export const clamp = (value,min,max) => Math.max(min,Math.min(value,max));\n');
  await git(repo,['add','.']);
  const patch=await git(repo,['diff','--cached','--binary','--no-ext-diff','--no-textconv',base,'--']);
  const tree=(await git(repo,['write-tree'])).trim();
  await git(repo,['-c','user.name=F control','-c','user.email=f@example.test','commit','-qm','fixed repaired control']);
  const head=(await git(repo,['rev-parse','HEAD'])).trim();
  const artifact={version:2,kind:'repository-patch',taskId:'p2-control',attemptId:'attempt-control',repository:'owner/pilot',baseCommit:base,patch,patchSha256:hash(patch),candidateTree:tree,changedPaths:[SOURCE]};
  const spec={version:1,id:'p2-control',role:'dev',goal:'repair clamp',repository:'owner/pilot',baseCommit:base,allowedPaths:[SOURCE],testPlanId:P2_TEST_PLAN.id,limits:{maxPatchBytes:65536}};
  const state={tasks:[{id:spec.id,role:'dev',state:'review',worker:'implementation-B',attemptId:artifact.attemptId,artifact:JSON.stringify(artifact)}]};
  const reservation=reserveReview(state,'dev','independent-F',Date.now(),60000,spec.id,3);
  const store={transact:async fn=>fn(state)};
  await fn({dir,repo,root,logs,head,artifact,spec,state,args:{spec,artifact,repositoryPath:repo,root,store,attemptId:artifact.attemptId,leaseToken:reservation.reviewToken,owner:'independent-F',imageDigest,runnerLimits:{timeoutMs:1000,memoryMb:128,cpus:0.5,pids:32,maxOutputBytes:65536},logRoot:logs}});
 }finally{await rm(dir,{recursive:true,force:true});}
}
function controlRunner({stdout=tap(),exitCode=0,inspect=async()=>{},context=()=>{}}={}){
 return identity=>{context(identity);return async run=>{
  // Explicit fixed runner substitute: this test does not execute a model or Docker.
  const task=await identity.store.transact(s=>s.tasks.find(t=>t.id===identity.taskId));
  if(task.state==='review'){assert.equal(task.reviewToken,identity.leaseToken);assert.equal(task.reviewOwner,identity.owner);assert.ok(task.reviewExpiresAt>Date.now());}
  else{assert.equal(task.state,'running');assert.equal(task.token,identity.leaseToken);assert.equal(task.worker,identity.owner);assert.ok(task.expiresAt>Date.now());}
  await inspect(run);
  return {runtime:'docker',imageDigest,commands:[{...run.commands[0],stdout,stderr:'',exitCode}]};
 };};
}
test('fixed runner substitute: verifies patch independently, sanitized staging and hashed logs',()=>fixture(async({args,logs})=>{
 let stage;
 const verify=createRepositoryArtifactVerifier({runnerFactory:controlRunner({inspect:async run=>{
  stage=run.workspace;
  assert.deepEqual(run.commands,P2_TEST_PLAN.commands);
  assert.equal((await readFile(join(stage,SOURCE),'utf8')).includes('Math.max'),true);
  await assert.rejects(lstat(join(stage,'.git')),{code:'ENOENT'});
  assert.match(await readFile(join(stage,'fixtures/p2-clamp/checks.mjs'),'utf8'),/fractional/);
 }})});
 const result=await verify(args);assert.equal(result.passed,true);
 const e=JSON.parse(result.evidence);assert.equal(e.kind,'acceptance');assert.equal(e.verifierId,'independent-F');assert.equal(e.tests.passed,7);assert.equal(e.commands[0].status,'passed');
 for(const log of e.logs){assert.ok(log.ref.startsWith(logs));assert.equal(hash(await readFile(log.ref)),log.sha256);}
 assert.equal(result.evidence.includes(args.leaseToken),false);
 await assert.rejects(lstat(stage),{code:'ENOENT'});
}));
test('fixed runner substitute: rejects partial, skipped, todo, failing and empty TAP despite exit zero',()=>fixture(async({args})=>{
 for(const stdout of [tap({total:6,passed:6}),tap({passed:6,skipped:1}),tap({passed:6,todo:1}),tap({passed:6,failed:1}),'']){
  const result=await createRepositoryArtifactVerifier({runnerFactory:controlRunner({stdout})})(args);
  assert.equal(result.passed,false);assert.equal(JSON.parse(result.evidence).commands[0].status,'failed');
 }
}));
test('fixed runner substitute: rejects nonzero exit even with seven passing TAP cases',()=>fixture(async({args})=>{
 assert.equal((await createRepositoryArtifactVerifier({runnerFactory:controlRunner({exitCode:1})})(args)).passed,false);
}));
test('artifact validation: rejects bad hash, tree, base and acceptance-file scope before running',()=>fixture(async({args,artifact})=>{
 let calls=0;const verify=createRepositoryArtifactVerifier({runnerFactory:()=>{calls++;throw Error('must not run');}});
 for(const change of [{patchSha256:'0'.repeat(64)},{candidateTree:'b'.repeat(40)},{baseCommit:'c'.repeat(40)},{changedPaths:['fixtures/p2-clamp/checks.mjs']}])await assert.rejects(verify({...args,artifact:{...artifact,...change}}));
 assert.equal(calls,0);
}));
test('testedCommit: checks exact committed tree and parent without applying the patch again',()=>fixture(async({args,head})=>{
 const verify=createRepositoryArtifactVerifier({runnerFactory:controlRunner()});
 const result=await verify({...args,testedCommit:head});assert.equal(result.passed,true);assert.equal(JSON.parse(result.evidence).testedCommit,head);
 await assert.rejects(verify({...args,testedCommit:args.spec.baseCommit}),/parent mismatch/);
}));
test('testedCommit: rejects unrelated patch bytes even when metadata tree and hash are internally consistent',()=>fixture(async({args,head,artifact})=>{
 const patch=artifact.patch+'\n';
 await assert.rejects(createRepositoryArtifactVerifier({runnerFactory:controlRunner()})({...args,testedCommit:head,artifact:{...artifact,patch,patchSha256:hash(patch)}}),/patch does not describe tested tree/);
}));
test('acceptance staging rejects tracked secrets; logs cannot be inside repository',()=>fixture(async({args,repo})=>{
 const verify=createRepositoryArtifactVerifier({runnerFactory:controlRunner()});
 await assert.rejects(verify({...args,logRoot:join(repo,'private-logs')}),/outside checkout/);
 // A secret in the base is an integration input error; no runner is started.
 await writeFile(join(repo,'.env'),'CONTROL_SECRET=not-a-real-secret\n');
 await git(repo,['add','.env']);await git(repo,['-c','user.name=F control','-c','user.email=f@example.test','commit','-qm','unsafe base control']);
 const base=(await git(repo,['rev-parse','HEAD'])).trim();
 await writeFile(join(repo,SOURCE),'export const clamp = (value,min,max) => min;\n');await git(repo,['add',SOURCE]);
 const patch=await git(repo,['diff','--cached','--binary','--no-ext-diff','--no-textconv',base,'--']);
 const artifact={...args.artifact,baseCommit:base,patch,patchSha256:hash(patch),candidateTree:(await git(repo,['write-tree'])).trim()};
 await assert.rejects(verify({...args,spec:{...args.spec,baseCommit:base},artifact}),/unsafe acceptance path/);
}));
test('acceptance staging rejects a tracked symbolic link before any runner invocation',()=>fixture(async({args,repo})=>{
 await symlink('fixtures/p2-clamp/clamp.mjs',join(repo,'linked-source'));
 await git(repo,['add','linked-source']);await git(repo,['-c','user.name=F control','-c','user.email=f@example.test','commit','-qm','linked base control']);
 const base=(await git(repo,['rev-parse','HEAD'])).trim();
 await writeFile(join(repo,SOURCE),'export const clamp = (value,min,max) => min;\n');await git(repo,['add',SOURCE]);
 const patch=await git(repo,['diff','--cached','--binary','--no-ext-diff','--no-textconv',base,'--']);
 const artifact={...args.artifact,baseCommit:base,patch,patchSha256:hash(patch),candidateTree:(await git(repo,['write-tree'])).trim()};
 let calls=0;
 await assert.rejects(createRepositoryArtifactVerifier({runnerFactory:()=>{calls++;throw Error('unexpected runner');}})({...args,spec:{...args.spec,baseCommit:base},artifact}),/regular tracked files/);
 assert.equal(calls,0);
}));
test('fixed runner substitute: separate audit lease does not change the reviewed artifact identity',()=>fixture(async({args,head,state})=>{
 state.tasks.push({id:'audit-head',role:'audit',state:'queued',attempts:0});
 const audit=claim(state,'audit','independent-auditor',Date.now(),60000,3);
 const result=await createRepositoryArtifactVerifier({runnerFactory:controlRunner({context:identity=>{assert.equal(identity.taskId,'audit-head');assert.equal(identity.attemptId,audit.attemptId);}})})({...args,owner:'independent-auditor',leaseToken:audit.token,runnerTaskId:audit.id,runnerAttemptId:audit.attemptId,testedCommit:head});
 const evidence=JSON.parse(result.evidence);assert.equal(result.passed,true);assert.equal(evidence.taskId,args.spec.id);assert.equal(evidence.attemptId,args.attemptId);assert.equal(evidence.testedCommit,head);
}));
test('production E runner refuses a stale review lease before calling Docker',()=>fixture(async({args})=>{
 await assert.rejects(createRepositoryArtifactVerifier()({...args,leaseToken:'stale-control-token'}),/stale resource lease/);
}));
