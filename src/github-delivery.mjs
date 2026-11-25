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

/** REST adapter. Credentials stay in trusted host, never in candidate execution. */
export function githubRemote({token,allowlist,fetchImpl=fetch,timeoutMs=15000}) {
 if(typeof token!=='string'||!token||!Array.isArray(allowlist)||!Number.isSafeInteger(timeoutMs)||timeoutMs<1)throw Error('invalid GitHub configuration');
 const root=r=>{if(!allowlist.includes(r)||!/^[-\w.]+\/[-\w.]+$/.test(r))throw Error('unauthorized repository');return 'https://api.github.com/repos/'+r;};
 async function request(r,path,{method='GET',body,missing=false}={}){
  const response=await fetchImpl(root(r)+path,{method,redirect:'error',signal:AbortSignal.timeout(timeoutMs),headers:{Authorization:'Bearer '+token,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28','Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
  if(response.status===404&&missing)return null;
  if(!response.ok)throw Error('GitHub HTTP '+response.status);
  return response.json();
 }
 async function pages(r,path,extract=x=>x){
  const result=[];
  for(let page=1;page<=100;page++){
   const rows=extract(await request(r,path+(path.includes('?')?'&':'?')+'per_page=100&page='+page));
   if(!Array.isArray(rows))throw Error('invalid GitHub list');
   result.push(...rows);
   if(rows.length<100)return result;
  }
  throw Error('GitHub pagination limit');
 }
 const enc=encodeURIComponent;
 return {
  async issue(r,n){if(!Number.isSafeInteger(n)||n<1)throw Error('invalid issue');const x=await request(r,'/issues/'+n);return {number:x.number,state:x.state,repository:r,pullRequest:!!x.pull_request};},
  async ref(r,b){const x=await request(r,'/git/ref/heads/'+enc(b),{missing:true});return x===null?null:x.object.sha;},
  async commit(r,s){if(!oid(s))throw Error('invalid commit');const x=await request(r,'/git/commits/'+s);return {tree:x.tree.sha,parent:x.parents.length===1?x.parents[0].sha:null};},
  async push(q,c){await request(q.repository,'/git/refs',{method:'POST',body:{ref:'refs/heads/'+q.branch,sha:c.sha}});},
  async findPRs(q){const owner=q.repository.split('/')[0];const rows=await pages(q.repository,'/pulls?state=all&head='+enc(owner+':'+q.branch));return rows.map(x=>({state:x.state,head:x.head.sha,base:x.base.sha,headBranch:x.head.ref,baseBranch:x.base.ref,repository:x.head.repo?.full_name,number:x.number,url:x.html_url}));},
  async createPR(q){return request(q.repository,'/pulls',{method:'POST',body:{head:q.branch,base:q.baseBranch,title:'Factory reviewed change '+q.branch.slice(-12),body:'Reviewed candidate; no automatic merge.',maintainer_can_modify:false}});},
  async checks(r,s){if(!oid(s))throw Error('invalid commit');const rows=await pages(r,'/commits/'+s+'/check-runs?filter=latest',x=>x.check_runs);return rows.map(x=>({name:x.name,sha:x.head_sha,id:x.id,conclusion:x.status==='completed'?x.conclusion:null}));}
 };
}
