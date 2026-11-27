import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync,spawnSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdtempSync,rmSync,mkdirSync,copyFileSync,chmodSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
export const BASE='353291288c07e937d41a67f2ea43bfd26c7697f2';
const plans={clamp:['fixtures/p2-clamp/clamp.mjs','fixtures/p2-clamp/checks.mjs',7],sum:['fixtures/p3-sum/sum.mjs','fixtures/p3-sum/checks.mjs',3]};
const sha=x=>createHash('sha256').update(x).digest('hex');
export function validate(e){
 assert.equal(e.baseCommit,BASE);
 assert.match(e.imageDigest,/^sha256:[a-f0-9]{64}$/);
 assert.equal(e.staleRejected,true);
 assert.equal(e.tasks.length,2);
 assert.deepEqual(e.tasks.map(t=>t.id).sort(),['clamp','sum']);
 return e.tasks.map(t=>{
  assert.equal(t.state,'review');
  const a=JSON.parse(t.artifact);
  assert.equal(a.version,2);assert.equal(a.kind,'repository-patch');
  assert.equal(a.taskId,t.id);assert.equal(a.baseCommit,BASE);
  assert.equal(a.repository,'overurdream-collab/AI-Software-Factory');
  assert.deepEqual(a.changedPaths,[plans[t.id][0]]);
  assert.match(a.candidateTree,/^[a-f0-9]{40}$/);
  assert.ok(typeof a.patch==='string'&&Buffer.byteLength(a.patch)<=16384);
  assert.equal(sha(a.patch),a.patchSha256);
  assert.ok(e.attempts.some(x=>x.taskId===t.id&&x.attemptId===a.attemptId&&x.state==='submitted'));
  return a;
 });
}
export function replay(e){
 const artifacts=validate(e), repo=resolve('.');
 const git=(cwd,args)=>execFileSync('git',['-c','core.hooksPath=/dev/null','-c','core.autocrlf=false',...args],{cwd,encoding:'utf8',timeout:30000});
 const results=[];
 for(const a of artifacts){
  const root=mkdtempSync(join(tmpdir(),'p3-replay-'));
  try{
   git(root,['clone','--no-local','--no-checkout','--',repo,'.']);
   git(root,['checkout','--detach',BASE]);
   const [source,checks,count]=plans[a.taskId];
   const staging=join(root,'.git','stage');mkdirSync(staging,{mode:0o755});chmodSync(root,0o755); const run=()=>{copyFileSync(join(root,source),join(staging,source.split('/').at(-1)));copyFileSync(join(root,checks),join(staging,'checks.mjs'));return spawnSync('docker',['run','--rm','--network=none','--read-only','--cap-drop=ALL','--security-opt=no-new-privileges','--memory=256m','--cpus=1','--pids-limit=64','--user=65534:65534','--mount','type=bind,src='+staging+',dst=/project,readonly','-w','/project','node@'+e.imageDigest,'node','--test','--test-reporter=tap','checks.mjs'],{encoding:'utf8',timeout:60000,maxBuffer:262144});};
   // Read-only disposable checkout; no host credentials or network.
   const baseline=run();assert.equal(baseline.status,1);assert.match(baseline.stdout,/^not ok /m);
   const patch=join(root,'.git','replay.diff');writeFileSync(patch,a.patch);
   git(root,['apply','--index','--binary','--',patch]);
   assert.equal(git(root,['write-tree']).trim(),a.candidateTree);
   assert.deepEqual(git(root,['diff','--name-only','-z',BASE,'--']).split('\0').filter(Boolean),[source]);
   assert.equal(sha(git(root,['diff','--binary','--no-ext-diff','--no-textconv',BASE,'--'])),a.patchSha256);
   const candidate=run();assert.equal(candidate.status,0);
   for(const [key,value] of [['tests',count],['pass',count],['fail',0],['skipped',0],['todo',0]])assert.match(candidate.stdout,new RegExp('^# '+key+' '+value+'$','m'));
   results.push({taskId:a.taskId,patchSha256:a.patchSha256,candidateTree:a.candidateTree,baselineExit:baseline.status,candidateExit:candidate.status,tests:count,baselineLogSha256:sha(baseline.stdout),candidateLogSha256:sha(candidate.stdout)});
  }finally{rmSync(root,{recursive:true,force:true});}
 }
 return results;
}
if(process.argv[1]&&resolve(process.argv[1])===new URL(import.meta.url).pathname&&process.argv[2])console.log(JSON.stringify({kind:'coordinator-replay-not-independent-acceptance',results:replay(JSON.parse(readFileSync(process.argv[2],'utf8')))},null,2));
