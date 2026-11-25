import { createHash } from 'node:crypto';
const hash = s => createHash('sha256').update(s).digest('hex');
const oid = s => typeof s === 'string' && /^[a-f0-9]{40}$/.test(s);
export function deliveryKey(spec) { return hash(JSON.stringify([spec.repository,spec.id])); }
export function validateArtifact(spec,a,e) {
  if (!a || a.version!==2 || a.kind!=='repository-patch' || a.taskId!==spec.id || a.repository!==spec.repository || a.baseCommit!==spec.baseCommit || !oid(a.baseCommit) || !oid(a.candidateTree) || typeof a.patch!=='string' || !a.patch || Buffer.byteLength(a.patch)>spec.limits.maxPatchBytes || hash(a.patch)!==a.patchSha256 || !Array.isArray(a.changedPaths) || !a.changedPaths.length || new Set(a.changedPaths).size!==a.changedPaths.length || a.changedPaths.some(p=>typeof p!=='string'||!spec.allowedPaths.includes(p)||p.split('/').some(x=>!x||x==='..'||x==='.'||x.toLowerCase()==='.git')||p.includes('\\'))) throw Error('invalid artifact');
  if (!e || e.passed!==true || e.taskId!==a.taskId || e.attemptId!==a.attemptId || e.repository!==a.repository || e.baseCommit!==a.baseCommit || e.patchSha256!==a.patchSha256 || e.candidateTree!==a.candidateTree) throw Error('approval mismatch');
}
export async function deliver({spec,artifact,approval,remote,prepare,baseBranch,requiredChecks,allowlist,assertLease}) {
  if (!allowlist.includes(spec.repository)||!requiredChecks.length) throw Error('unauthorized delivery');
  validateArtifact(spec,artifact,approval);
  const repository=spec.repository,key=deliveryKey(spec),branch='factory/'+key;
  const request={repository,branch,baseBranch};
  const checkBase=async()=>{if(await remote.ref(repository,baseBranch)!==spec.baseCommit) throw Error('base changed');};
  await checkBase();
  const candidate=await prepare(spec,artifact);
  if(candidate.tree!==artifact.candidateTree || !oid(candidate.sha) || candidate.parent!==spec.baseCommit) throw Error('prepared commit mismatch');
  let head=await remote.ref(repository,branch);
  if(!head){ await assertLease(); await checkBase(); try{await remote.push(request,candidate);}catch(err){if(!await remote.ref(repository,branch))throw err;} head=await remote.ref(repository,branch); }
  const commit=await remote.commit(repository,head);
  if(commit.tree!==artifact.candidateTree||commit.parent!==spec.baseCommit)throw Error('remote commit mismatch');
  let prs=await remote.findPRs(request);
  if(!prs.length){await assertLease();await checkBase();try{await remote.createPR({...request,head});}catch(err){if(!(await remote.findPRs(request)).length)throw err;}prs=await remote.findPRs(request);}
  if(prs.length!==1)throw Error('ambiguous PR');
  const pr=prs[0];
  if(pr.state!=='open'||pr.head!==head||pr.base!==spec.baseCommit||pr.headBranch!==branch||pr.baseBranch!==baseBranch||pr.repository!==repository)throw Error('PR mismatch');
  const checks=await remote.checks(repository,head);
  const selected=requiredChecks.map(name=>checks.filter(c=>c.name===name&&c.sha===head));
  const passed=selected.every(cs=>cs.length===1&&cs[0].conclusion==='success'&&cs[0].id);
  await checkBase(); await assertLease();
  if(await remote.ref(repository,branch)!==head)throw Error('head changed');
  return {key,repository,branch,commitSha:head,prNumber:pr.number,prUrl:pr.url,state:passed?'delivered':'blocked',...(passed?{checkedCommit:head,checkRunIds:selected.map(cs=>cs[0].id)}:{failure:'required head checks not successful'})};
}
