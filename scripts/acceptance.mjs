import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdtemp,writeFile,rm,lstat,realpath} from 'node:fs/promises';
import {join,sep} from 'node:path';
const sha=s=>createHash('sha256').update(s).digest('hex');
const oid=s=>typeof s==='string'&&/^[a-f0-9]{40}$/.test(s);
const safe=p=>typeof p==='string'&&/^[a-zA-Z0-9_./-]+$/.test(p)&&!p.startsWith('-')&&!p.split('/').some(x=>!x||x==='.'||x==='..'||x.toLowerCase()==='.git')&&!/^(test|tests|__tests__|scripts|\.github|docs\/evidence)(\/|$)/i.test(p)&&!/\.(test|spec)\./i.test(p);
function git(cwd,...args){return execFileSync('git',['-c','core.hooksPath=/dev/null','-c','core.autocrlf=false','-c','core.fsmonitor=false',...args],{cwd,encoding:'utf8',timeout:30000,maxBuffer:4*1024*1024,env:{PATH:process.env.PATH,HOME:'/nonexistent',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_TERMINAL_PROMPT:'0',LC_ALL:'C'}});}
function requireThat(value,message){if(!value)throw Error(message);}
async function regular(dir,p){
 let f=dir;
 for(const part of p.split('/')){f=join(f,part);requireThat(!(await lstat(f)).isSymbolicLink(),'symlink');}
 requireThat((await lstat(f)).isFile()&&(await realpath(f)).startsWith(dir+sep),'not regular source');
}
function counts(output){
 const get=k=>{const m=[...output.matchAll(new RegExp('^# '+k+' (\\d+)\\s*$','gm'))];requireThat(m.length===1,'missing or ambiguous TAP count');return Number(m[0][1]);};
 const n={passed:get('pass'),failed:get('fail'),skipped:get('skipped')};
 requireThat(get('tests')===n.passed+n.failed+n.skipped&&get('todo')===0,'inconsistent TAP counts');return n;
}
// Operator owns spec, runner, plan and log sink. Never use a candidate-provided runner.
// Runner must stage a clean read-only export and execute in isolated Docker in live use.
// This function alone does not attest runner/model provenance.
export async function verifyRepositoryArtifact({spec,artifact,expectedAttemptId,repositoryPath,root,plan,runProject,runnerLimits,imageDigest,verifierId,saveLog,signal}){
 const a=typeof artifact==='string'?JSON.parse(artifact):artifact;
 requireThat(spec?.version===1&&a?.version===2&&a.kind==='repository-patch'&&a.taskId===spec.id&&a.attemptId===expectedAttemptId&&!!expectedAttemptId&&a.repository===spec.repository&&a.baseCommit===spec.baseCommit&&oid(a.baseCommit)&&oid(a.candidateTree),'artifact identity mismatch');
 requireThat(typeof a.patch==='string'&&a.patch.length&&Buffer.byteLength(a.patch)<=spec.limits.maxPatchBytes&&sha(a.patch)===a.patchSha256,'patch digest/size');
 requireThat(Array.isArray(a.changedPaths)&&a.changedPaths.length===1&&a.changedPaths.every(p=>safe(p)&&spec.allowedPaths.includes(p)),'patch scope');
 requireThat(plan?.id===spec.testPlanId&&Array.isArray(plan.commands)&&plan.commands.length&&plan.commands.every(c=>Array.isArray(c.argv)&&c.argv.length&&c.argv.every(x=>typeof x==='string'&&!x.includes('\0'))&&(c.cwd==='.'||safe(c.cwd))&&Number.isSafeInteger(c.minTests)&&c.minTests>0),'invalid trusted plan');
 requireThat(/^sha256:[a-f0-9]{64}$/.test(imageDigest)&&typeof saveLog==='function'&&typeof runProject==='function'&&typeof verifierId==='string'&&verifierId.length,'missing trusted runtime');
 const startedAt=Date.now(),dir=await mkdtemp(join(await realpath(root),'f-review-'));
 const commands=[],logs=[];let totals={passed:0,failed:0,skipped:0};
 try{
  git(dir,'clone','--no-local','--no-checkout','--',await realpath(repositoryPath),'.');
  git(dir,'checkout','--detach',a.baseCommit);
  requireThat(git(dir,'rev-parse','HEAD').trim()===a.baseCommit&&!git(dir,'status','--porcelain'),'base checkout mismatch');
  const p=a.changedPaths[0];await regular(dir,p);
  const mode=git(dir,'ls-files','--stage','--',p).slice(0,6);requireThat(['100644','100755'].includes(mode),'invalid base mode');
  async function run(phase){
   signal?.throwIfAborted();
   const trusted=plan.commands.map(({argv,cwd})=>({argv:[...argv],cwd}));
   const result=await runProject({workspace:dir,commands:trusted,limits:runnerLimits,signal});
   requireThat(result?.runtime==='docker'&&result.imageDigest===imageDigest&&result.commands?.length===trusted.length,'runtime evidence mismatch');
   let failures=0;
   for(let i=0;i<trusted.length;i++){
    const c=result.commands[i],t=trusted[i];
    requireThat(JSON.stringify(c.argv)===JSON.stringify(t.argv)&&c.cwd===t.cwd&&[0,1].includes(c.exitCode),'command or infrastructure failure');
    const n=counts(c.stdout);
    requireThat(n.skipped===0&&n.passed+n.failed>=plan.commands[i].minTests&&c.exitCode===(n.failed?1:0),'test count/exit mismatch');
    failures+=n.failed;
    const raw=JSON.stringify({phase,argv:t.argv,cwd:t.cwd,exitCode:c.exitCode,stdout:c.stdout,stderr:c.stderr??''});
    const ref=await saveLog({phase,index:i,raw,sha256:sha(raw)});
    requireThat(typeof ref==='string'&&ref.length,'missing durable log reference');
    logs.push({ref,sha256:sha(raw)});
    if(phase==='candidate'){commands.push({...t,exitCode:c.exitCode,status:c.exitCode===0?'passed':'failed'});for(const k of Object.keys(totals))totals[k]+=n[k];}
   }
   return failures;
  }
  requireThat(await run('baseline')>0,'baseline did not fail');
  requireThat(!git(dir,'status','--porcelain'),'baseline modified');
  await writeFile(join(dir,'.git','f.patch'),a.patch,{mode:0o600});
  git(dir,'apply','--check','--index','.git/f.patch');git(dir,'apply','--index','.git/f.patch');
  requireThat(git(dir,'diff','--cached','--name-only','-z').split('\0').filter(Boolean).join('\0')===p,'actual path mismatch');
  await regular(dir,p);
  requireThat(git(dir,'ls-files','--stage','--',p).slice(0,6)===mode&&git(dir,'write-tree').trim()===a.candidateTree,'mode/tree mismatch');
  requireThat(await run('candidate')===0,'candidate failed independent tests');
  requireThat(git(dir,'write-tree').trim()===a.candidateTree&&!git(dir,'diff','--name-only')&&!git(dir,'ls-files','--others','--exclude-standard'),'candidate changed during verification');
  return {passed:true,evidence:JSON.stringify({version:1,kind:'acceptance',taskId:a.taskId,attemptId:a.attemptId,verifierId,repository:a.repository,baseCommit:a.baseCommit,patchSha256:a.patchSha256,candidateTree:a.candidateTree,startedAt,finishedAt:Date.now(),commands,tests:totals,logs})};
 }finally{await rm(dir,{recursive:true,force:true});}
}
