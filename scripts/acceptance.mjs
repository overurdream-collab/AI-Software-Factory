import {createHash,randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile,writeFile,mkdtemp,mkdir,realpath,lstat,rm} from 'node:fs/promises';
import {join,resolve,dirname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createProjectRunner} from '../src/sandbox.mjs';

const exec=promisify(execFile);
const sha=value=>createHash('sha256').update(value).digest('hex');
const oid=value=>typeof value==='string'&&/^[a-f0-9]{40}$/.test(value);
const SOURCE='fixtures/p2-clamp/clamp.mjs';
const CHECKS='fixtures/p2-clamp/checks.mjs';
const CHECK_SOURCE=fileURLToPath(new URL('../fixtures/p2-clamp/checks.mjs',import.meta.url));
export const P2_TEST_PLAN={id:'p2-clamp-v1',commands:[{argv:['node','--test','--test-reporter=tap',CHECKS],cwd:'.'}]};
const commands=()=>structuredClone(P2_TEST_PLAN.commands);
const within=(parent,path)=>path===parent||path.startsWith(parent+sep);
const forbidden=p=>p.split('/').some(n=>!n||n==='.'||n==='..'||/^(?:\.git|\.env(?:\..*)?|\.npmrc|\.netrc|id_rsa|id_ed25519|credentials(?:\..*)?)$/i.test(n)||/\.(?:pem|key|p12|pfx)$/i.test(n));
async function git(cwd,args,signal){
 signal?.throwIfAborted();
 return (await exec('git',['-c','core.hooksPath=/dev/null','-c','core.fsmonitor=false','-c','core.autocrlf=false',...args],{cwd,signal,timeout:30000,maxBuffer:4*1024*1024,env:{PATH:process.env.PATH,HOME:'/nonexistent',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_TERMINAL_PROMPT:'0',LC_ALL:'C'}})).stdout;
}
function parseTap(stdout){
 const read=name=>{const rows=[...stdout.matchAll(new RegExp('^# '+name+' ([0-9]+)\\r?$','gm'))];return rows.length===1?Number(rows[0][1]):null;};
 const total=read('tests'),passed=read('pass'),failed=read('fail'),skipped=read('skipped'),todo=read('todo');
 const plans=[...stdout.matchAll(/^1\.\.([0-9]+)\r?$/gm)];
 const oks=[...stdout.matchAll(/^ok [0-9]+ - .+$/gm)].length;
 const valid=total===7&&passed===7&&failed===0&&skipped===0&&todo===0&&plans.length===1&&plans[0][1]==='7'&&oks===7&&!/^not ok /m.test(stdout)&&!/^(?:not )?ok .+ # (?:SKIP|TODO)\b/im.test(stdout);
 return {total,passed:passed??0,failed:failed??0,skipped:skipped??0,todo:todo??0,valid};
}
async function stageTracked(workspace,staging,signal){
 const rows=(await git(workspace,['ls-files','--stage','-z'],signal)).split('\0').filter(Boolean);
 let bytes=0;
 if(rows.length>4000)throw Error('acceptance file count limit');
 for(const row of rows){
  signal?.throwIfAborted();
  const match=/^(100644|100755) [a-f0-9]{40} 0\t(.+)$/.exec(row);
  if(!match)throw Error('acceptance requires regular tracked files');
  const path=match[2];
  if(forbidden(path)||path.includes('\\')||path.startsWith('/'))throw Error('unsafe acceptance path');
  let part=workspace;
  for(const name of path.split('/')){part=join(part,name);if((await lstat(part)).isSymbolicLink())throw Error('acceptance rejects symlinks');}
  if(!(await lstat(part)).isFile())throw Error('acceptance rejects non-file');
  const data=await readFile(part);
  if((bytes+=data.length)>32*1024*1024)throw Error('acceptance workspace size limit');
  await mkdir(dirname(join(staging,path)),{recursive:true,mode:0o755});
  await writeFile(join(staging,path),data,{mode:match[1]==='100755'?0o755:0o644});
 }
 await mkdir(dirname(join(staging,CHECKS)),{recursive:true,mode:0o755});
 await writeFile(join(staging,CHECKS),await readFile(CHECK_SOURCE),{mode:0o644});
}

// Injection is exclusively for labelled component tests. Production export below fixes E's Docker runner.
export function createRepositoryArtifactVerifier({runnerFactory=createProjectRunner,clock=Date.now}={}){
 return async function verifyRepositoryArtifact({spec,artifact,repositoryPath,root,store,attemptId,leaseToken,owner,imageDigest,runnerLimits,signal,testedCommit,logRoot,runnerTaskId,runnerAttemptId}){
  const startedAt=clock();
  const a=typeof artifact==='string'?JSON.parse(artifact):structuredClone(artifact);
  if(spec?.version!==1||spec.testPlanId!==P2_TEST_PLAN.id||JSON.stringify(spec.allowedPaths)!==JSON.stringify([SOURCE])||!spec.id||!/^[-\w.]+\/[-\w.]+$/.test(spec.repository)||!oid(spec.baseCommit)||!Number.isSafeInteger(spec.limits?.maxPatchBytes)||spec.limits.maxPatchBytes<1)throw Error('invalid acceptance specification');
  if(a?.version!==2||a.kind!=='repository-patch'||a.taskId!==spec.id||a.attemptId!==attemptId||a.repository!==spec.repository||a.baseCommit!==spec.baseCommit||!oid(a.candidateTree)||typeof a.patch!=='string'||!a.patch||Buffer.byteLength(a.patch)>spec.limits.maxPatchBytes||sha(a.patch)!==a.patchSha256||JSON.stringify(a.changedPaths)!==JSON.stringify([SOURCE]))throw Error('invalid acceptance artifact');
  if(!store||!attemptId||!leaseToken||!owner||!/^sha256:[a-f0-9]{64}$/.test(imageDigest)||testedCommit!==undefined&&!oid(testedCommit))throw Error('invalid acceptance runner identity');
  const parent=await realpath(root),repo=await realpath(repositoryPath);
  await mkdir(logRoot,{recursive:true,mode:0o700});
  const logsPath=await realpath(logRoot);
  if(within(repo,logsPath))throw Error('acceptance logs must be outside checkout');
  const job=await mkdtemp(join(parent,'acceptance-'));
  // Docker's unprivileged user must traverse the staging path; logs stay outside it.
  const checkout=join(job,'checkout'),staging=join(job,'staging');
  await mkdir(checkout,{mode:0o700});await mkdir(staging,{mode:0o755});
  try{
   await git(checkout,['clone','--no-local','--no-checkout','--',repo,'.'],signal);
   await git(checkout,['checkout','--detach',testedCommit??spec.baseCommit],signal);
   if(await git(checkout,['status','--porcelain'],signal))throw Error('acceptance dirty checkout');
   if((await git(checkout,['rev-parse','HEAD'],signal)).trim()!==(testedCommit??spec.baseCommit))throw Error('acceptance checkout mismatch');
   const before=(await git(checkout,['ls-tree',spec.baseCommit,'--',SOURCE],signal)).trim();
   if(!/^100(?:644|755) blob [a-f0-9]{40}\t/.test(before))throw Error('acceptance source missing from base');
   if(testedCommit){
    const parents=(await git(checkout,['rev-list','--parents','-n','1',testedCommit],signal)).trim().split(' ');
    if(parents.length!==2||parents[1]!==spec.baseCommit)throw Error('acceptance tested commit parent mismatch');
   }else{
    const patchPath=join(job,'candidate.diff');await writeFile(patchPath,a.patch,{mode:0o600});
    await git(checkout,['apply','--index','--binary','--',patchPath],signal);
   }
   const paths=(await git(checkout,['diff','--name-only','-z',spec.baseCommit,'--'],signal)).split('\0').filter(Boolean);
   if(JSON.stringify(paths)!==JSON.stringify([SOURCE]))throw Error('acceptance changed paths mismatch');
   const indexTree=(await git(checkout,['write-tree'],signal)).trim();
   if(indexTree!==a.candidateTree)throw Error('acceptance tree mismatch');
   const observedPatch=await git(checkout,['diff','--binary','--no-ext-diff','--no-textconv',spec.baseCommit,'--'],signal);
   if(sha(observedPatch)!==a.patchSha256)throw Error('acceptance patch does not describe tested tree');
   const after=(await git(checkout,['ls-files','--stage','--',SOURCE],signal)).trim();
   if(after.slice(0,6)!==before.slice(0,6))throw Error('acceptance source mode changed');
   await stageTracked(checkout,staging,signal);
   const runProject=runnerFactory({store,taskId:runnerTaskId??spec.id,attemptId:runnerAttemptId??attemptId,leaseToken,owner,clock,imageDigest});
   const result=await runProject({workspace:staging,commands:commands(),signal,limits:runnerLimits});
   signal?.throwIfAborted();
   const rows=result?.commands;
   if(result?.runtime!=='docker'||result.imageDigest!==imageDigest||!Array.isArray(rows)||rows.length!==1||JSON.stringify(rows[0].argv)!==JSON.stringify(P2_TEST_PLAN.commands[0].argv)||rows[0].cwd!=='.'||!Number.isInteger(rows[0].exitCode)||typeof rows[0].stdout!=='string'||typeof rows[0].stderr!=='string')throw Error('incomplete acceptance runner evidence');
   const tests=parseTap(rows[0].stdout);
   const passed=rows[0].exitCode===0&&tests.valid;
   const logs=[];
   for(const channel of ['stdout','stderr']){
    const ref=join(logsPath,randomUUID()+'.'+channel+'.log');
    await writeFile(ref,rows[0][channel],{flag:'wx',mode:0o600});logs.push({ref,sha256:sha(rows[0][channel])});
   }
   const evidence={version:1,kind:'acceptance',taskId:spec.id,attemptId,verifierId:owner,repository:spec.repository,baseCommit:spec.baseCommit,patchSha256:a.patchSha256,candidateTree:a.candidateTree,...(testedCommit?{testedCommit}:{}),startedAt,finishedAt:clock(),commands:rows.map(({argv,cwd,exitCode})=>({argv,cwd,exitCode,status:passed?'passed':'failed'})),tests:{total:tests.total,passed:tests.passed,failed:tests.failed,skipped:tests.skipped,todo:tests.todo},logs,runtime:result.runtime,imageDigest,passed};
   return {passed,evidence:JSON.stringify(evidence)};
  }finally{await rm(job,{recursive:true,force:true});}
 };
}
export const verifyRepositoryArtifact=createRepositoryArtifactVerifier();
