import {createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {createWorkspace,git,sourceFile,safePath,oid} from './workspace.mjs';
const sha=s=>createHash('sha256').update(s).digest('hex');
// All dependencies except generate are operator supplied; runProject must be E's isolated runner in live mode.
export async function repairRepository({spec,attemptId,repositoryPath,root,generate,runProject,testPlan,runnerLimits,signal,onEvidence=async()=>{}}){
 if(spec?.version!==1||spec.role!=='dev'||!oid(spec.baseCommit)||!spec.id||!attemptId||!/^[-\w.]+\/[-\w.]+$/.test(spec.repository)||!Array.isArray(spec.allowedPaths)||spec.allowedPaths.length!==1||testPlan?.id!==spec.testPlanId||!Array.isArray(testPlan.commands)||!testPlan.commands.length)throw Error('invalid pilot specification');
 const path=safePath(spec.allowedPaths[0]),{maxAttempts,maxPatchBytes,deadlineMs}=spec.limits;
 if(!Number.isSafeInteger(maxAttempts)||maxAttempts<1||maxAttempts>10||!Number.isSafeInteger(maxPatchBytes)||maxPatchBytes<1||maxPatchBytes>262144||!Number.isSafeInteger(deadlineMs)||deadlineMs<1)throw Error('invalid limits');
 const deadline=AbortSignal.timeout(deadlineMs);signal=signal?AbortSignal.any([signal,deadline]):deadline;
 const commands=structuredClone(testPlan.commands);
 if(commands.some(c=>!Array.isArray(c.argv)||!c.argv.length||c.argv.some(a=>typeof a!=='string'||a.includes('\0'))||typeof c.cwd!=='string'||(c.cwd!=='.'&&!safePath(c.cwd))))throw Error('invalid test plan');
 const {workspace,cleanup}=await createWorkspace({root,repositoryPath,baseCommit:spec.baseCommit,signal});
 try{
  const file=await sourceFile(workspace,path,signal);let source=await readFile(file,'utf8'),feedback='';
  const run=async phase=>{
   signal.throwIfAborted();const result=await runProject({workspace,commands:structuredClone(commands),signal,limits:runnerLimits});signal.throwIfAborted();
   if(!Array.isArray(result?.commands)||result.commands.length!==commands.length||result.commands.some((c,i)=>JSON.stringify(c.argv)!==JSON.stringify(commands[i].argv)||c.cwd!==commands[i].cwd||!Number.isInteger(c.exitCode)))throw Error('incomplete runner evidence');
   await onEvidence({phase,result});return result.commands.every(c=>c.exitCode===0);
  };
  if(await run('baseline'))throw Error('baseline did not reproduce failure');
  if(await git(workspace,['status','--porcelain'],signal))throw Error('runner changed baseline');
  for(let n=1;n<=maxAttempts;n++){
   const goal=spec.goal+feedback;if(Buffer.byteLength(source)+Buffer.byteLength(goal)>65536)throw Error('input limit');
   const candidate=await generate({source,goal,signal});signal.throwIfAborted();
   if(typeof candidate!=='string'||!candidate.trim()||Buffer.byteLength(candidate)>65536||candidate===source)throw Error('invalid candidate');
   await writeFile(await sourceFile(workspace,path,signal),candidate);
   await git(workspace,['add','--',path],signal);
   const patch=await git(workspace,['diff','--cached','--binary','--no-ext-diff','--no-textconv',spec.baseCommit,'--'],signal);
   const changed=(await git(workspace,['diff','--cached','--name-only','-z',spec.baseCommit,'--'],signal)).split('\0').filter(Boolean);
   if(!patch||Buffer.byteLength(patch)>maxPatchBytes||changed.length!==1||changed[0]!==path)throw Error('patch scope or size');
   const candidateTree=(await git(workspace,['write-tree'],signal)).trim();
   const passed=await run('candidate-'+n);
   if((await git(workspace,['write-tree'],signal)).trim()!==candidateTree||await git(workspace,['diff','--name-only'],signal)||await git(workspace,['ls-files','--others','--exclude-standard'],signal))throw Error('runner changed candidate');
   if(passed)return JSON.stringify({version:2,kind:'repository-patch',taskId:spec.id,attemptId,repository:spec.repository,baseCommit:spec.baseCommit,patch,patchSha256:sha(patch),candidateTree,changedPaths:changed});
   source=candidate;feedback='\nPrevious candidate failed the operator test plan. Repair the failure without changing tests.';
  }
  throw Error('repair attempts exhausted');
 }finally{await cleanup();}
}

// Host-only adapter: use the real A/E factories after coordinator integration.
// The SQLite store is injected by D; no external operation runs inside transact.
export async function executeLiveRepository({spec,attemptId,leaseToken,owner,store,repositoryPath,root,testPlan,runnerLimits,imageDigest,providerConfig,approvedRepositories,signal,clock=Date.now}){
 if(!store||typeof store.transact!=='function'||!Array.isArray(approvedRepositories)||!approvedRepositories.includes(spec?.repository)||!attemptId||!leaseToken||!owner||!/^sha256:[a-f0-9]{64}$/.test(imageDigest))throw Error('invalid live execution authorization');
 const {ollamaGenerator}=await import('./ollama.mjs');
 const {createProjectRunner}=await import('./sandbox.mjs');
 if(typeof createProjectRunner!=='function')throw Error('E project runner not integrated');
 const generate=ollamaGenerator(providerConfig);
 const isolated=createProjectRunner({store,taskId:spec.id,attemptId,leaseToken,owner,clock,imageDigest});
 const persist=async event=>store.transact(state=>{
  const t=state.tasks.find(t=>t.id===spec.id&&t.attemptId===attemptId);
  if(!t||t.state!=='running'||t.token!==leaseToken||t.worker!==owner||t.expiresAt<=clock())throw Error('stale evidence lease');
  state.repositoryEvidence??=[];
  state.repositoryEvidence.push({version:1,taskId:spec.id,attemptId,repository:spec.repository,baseCommit:spec.baseCommit,at:clock(),...event});
 });
 const runProject=async input=>{
  const {stageProject}=await import('./workspace.mjs');
  const staged=await stageProject(input.workspace,input.signal);
  try{
   const result=await isolated({...input,workspace:staged.workspace});
   if(result.runtime!=='docker'||result.imageDigest!==imageDigest)throw Error('unexpected runtime evidence');
   if(result.commands.some(c=>[125,126,127].includes(c.exitCode)))throw Error('sandbox infrastructure failure');
   return result;
  }finally{await staged.cleanup();}
 };
 await persist({phase:'started',model:providerConfig?.model??'qwen3:8b',imageDigest});
 try{
  const artifact=await repairRepository({spec,attemptId,repositoryPath,root,generate,runProject,testPlan,runnerLimits,signal,onEvidence:async({phase,result})=>{
   // Candidate-controlled stdout/stderr may contain secrets or forged test counts.
   // Persist only fingerprints and command outcomes; F owns independent raw evidence.
   await persist({phase,runtime:result.runtime,imageDigest:result.imageDigest,commands:result.commands.map(c=>({argv:c.argv,cwd:c.cwd,exitCode:c.exitCode,stdoutSha256:sha(c.stdout??''),stderrSha256:sha(c.stderr??'')}))});
  }});
  const p=JSON.parse(artifact);
  await persist({phase:'candidate-ready',artifact,patchSha256:p.patchSha256,candidateTree:p.candidateTree});
  return artifact;
 }catch(error){
  // No exception text from untrusted project/model is persisted.
  await persist({phase:'blocked-or-failed'});throw error;
 }
}
