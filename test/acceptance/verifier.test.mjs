import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {verifyRepositoryArtifact} from '../../scripts/acceptance.mjs';
const hash=s=>createHash('sha256').update(s).digest('hex');
const imageDigest='sha256:'+'a'.repeat(64);
const git=(cwd,...args)=>execFileSync('git',args,{cwd,encoding:'utf8',stdio:['pipe','pipe','pipe']});
async function fixture(fn){
 const root=await mkdtemp(join(tmpdir(),'f-verifier-'));
 try{
  git(root,'init','-q');await writeFile(join(root,'source.mjs'),'export const value=0;\n');git(root,'add','source.mjs');git(root,'-c','user.name=F','-c','user.email=f@example.invalid','commit','-qm','base');
  const baseCommit=git(root,'rev-parse','HEAD').trim();
  await writeFile(join(root,'source.mjs'),'export const value=1;\n');const patch=git(root,'diff','--','source.mjs');git(root,'add','source.mjs');const candidateTree=git(root,'write-tree').trim();git(root,'reset','--hard',baseCommit);
  const artifact={version:2,kind:'repository-patch',taskId:'t',attemptId:'a',repository:'fixture/local',baseCommit,patch,patchSha256:hash(patch),candidateTree,changedPaths:['source.mjs']};
  const spec={version:1,id:'t',repository:'fixture/local',baseCommit,allowedPaths:['source.mjs'],testPlanId:'f',limits:{maxPatchBytes:65536}};
  const plan={id:'f',commands:[{argv:['node','--test','--test-reporter=tap'],cwd:'.',minTests:2}]};
  const logs=[];let calls=0;
  // Synthetic runner: intentionally NOT proof of Docker or model provenance.
  const runProject=async({commands})=>{const fail=calls++===0;return {runtime:'docker',imageDigest,commands:commands.map(c=>({...c,exitCode:fail?1:0,stdout:'# tests 2\n# pass '+(fail?1:2)+'\n# fail '+(fail?1:0)+'\n# skipped 0\n# todo 0\n',stderr:''}))};};
  await fn({spec,artifact,expectedAttemptId:'a',repositoryPath:root,root:tmpdir(),plan,runProject,imageDigest,verifierId:'F',saveLog:async l=>{logs.push(l);return 'fixture:'+logs.length;}},logs);
 }finally{await rm(root,{recursive:true,force:true});}
}
test('F replays patch and emits bound acceptance evidence (synthetic runner)',()=>fixture(async(o,logs)=>{const r=await verifyRepositoryArtifact(o),e=JSON.parse(r.evidence);assert.equal(r.passed,true);assert.equal(e.candidateTree,o.artifact.candidateTree);assert.deepEqual(e.tests,{passed:2,failed:0,skipped:0});assert.equal(logs.length,2);assert.equal(e.logs[1].sha256,hash(logs[1].raw));}));
test('F rejects stale attempt before runner',()=>fixture(async o=>assert.rejects(verifyRepositoryArtifact({...o,expectedAttemptId:'old'}),/identity/)));
test('F rejects incorrect tree',()=>fixture(async o=>assert.rejects(verifyRepositoryArtifact({...o,artifact:{...o.artifact,candidateTree:'0'.repeat(40)}}),/tree/)));
test('F refuses missing log reference',()=>fixture(async o=>assert.rejects(verifyRepositoryArtifact({...o,saveLog:async()=>''}),/log reference/)));
test('F rejects infrastructure exit rather than accepting red baseline',()=>fixture(async o=>assert.rejects(verifyRepositoryArtifact({...o,runProject:async({commands})=>({runtime:'docker',imageDigest,commands:commands.map(c=>({...c,exitCode:125}))})}),/infrastructure/)));
test('F rejects missing test counts',()=>fixture(async o=>assert.rejects(verifyRepositoryArtifact({...o,runProject:async({commands})=>({runtime:'docker',imageDigest,commands:commands.map(c=>({...c,exitCode:0,stdout:'ok'}))})}),/TAP count/)));
