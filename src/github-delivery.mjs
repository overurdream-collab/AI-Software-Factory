import { createHash, createSign } from 'node:crypto';
const hash = s => createHash('sha256').update(s).digest('hex');
const oid = s => typeof s === 'string' && /^[a-f0-9]{40}$/.test(s);
export function deliveryKey(spec) { return spec.repository+':'+hash(JSON.stringify([spec.repository,spec.id])); }
export function validateArtifact(spec,a,e) {
  if (!a || a.version!==2 || a.kind!=='repository-patch' || a.taskId!==spec.id || a.repository!==spec.repository || a.baseCommit!==spec.baseCommit || !oid(a.baseCommit) || !oid(a.candidateTree) || typeof a.patch!=='string' || !a.patch || Buffer.byteLength(a.patch)>spec.limits.maxPatchBytes || hash(a.patch)!==a.patchSha256 || !Array.isArray(a.changedPaths) || !a.changedPaths.length || new Set(a.changedPaths).size!==a.changedPaths.length || a.changedPaths.some(p=>typeof p!=='string'||!spec.allowedPaths.includes(p)||p.split('/').some(x=>!x||x==='..'||x==='.'||x.toLowerCase()==='.git')||p.includes('\\'))) throw Error('invalid artifact');
  if (!e || e.passed!==true || e.taskId!==a.taskId || e.attemptId!==a.attemptId || e.repository!==a.repository || e.baseCommit!==a.baseCommit || e.patchSha256!==a.patchSha256 || e.candidateTree!==a.candidateTree) throw Error('approval mismatch');
}
export async function deliver({spec,artifact,approval,remote,prepare,baseBranch,requiredChecks,allowlist,assertLease}) {
  if (!allowlist.includes(spec.repository)||!requiredChecks.length) throw Error('unauthorized delivery');
  validateArtifact(spec,artifact,approval);
  const repository=spec.repository,key=deliveryKey(spec),branch='factory/'+hash(key);
  const request={repository,branch,baseBranch};
  const checkBase=async()=>{if(await remote.ref(repository,baseBranch)!==spec.baseCommit) throw Error('base changed');};
  await checkBase();
  let head=await remote.ref(repository,branch);
  const candidate=head?null:await prepare(spec,artifact);
  if(candidate && (candidate.tree!==artifact.candidateTree || !oid(candidate.sha) || candidate.parent!==spec.baseCommit)) throw Error('prepared commit mismatch');
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
  const finalPRs=await remote.findPRs(request);
  if(finalPRs.length!==1||finalPRs[0].number!==pr.number||finalPRs[0].state!=='open'||finalPRs[0].head!==head||finalPRs[0].base!==spec.baseCommit)throw Error('PR changed');
  return {key,repository,branch,commitSha:head,prNumber:pr.number,prUrl:pr.url,state:passed?'delivered':'pending',...(passed?{checkedCommit:head,checkRunIds:selected.map(cs=>cs[0].id)}:{failure:'required head checks not successful'})};
}

/** REST adapter. Credentials stay in trusted host, never in candidate execution. */
export function githubRemote({token,tokenProvider,allowlist,fetchImpl=fetch,timeoutMs=15000}) {
 if((typeof tokenProvider!=='function'&&(typeof token!=='string'||!token))||!Array.isArray(allowlist)||!Number.isSafeInteger(timeoutMs)||timeoutMs<1)throw Error('invalid GitHub configuration');
 const root=r=>{if(!allowlist.includes(r)||!/^[-\w.]+\/[-\w.]+$/.test(r))throw Error('unauthorized repository');return 'https://api.github.com/repos/'+r;};
 async function request(r,path,{method='GET',body,missing=false}={}){
  const url=root(r)+path;
  const access=tokenProvider?await tokenProvider(r):token;
  if(typeof access!=='string'||!access)throw Error('missing GitHub credential');
  const response=await fetchImpl(url,{method,redirect:'error',signal:AbortSignal.timeout(timeoutMs),headers:{Authorization:'Bearer '+access,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28','Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
  if(response.status===404&&missing)return null;
  if(!response.ok){const err=new Error('GitHub HTTP '+response.status+' '+method+' '+path.split('?')[0]);err.status=response.status;err.requiredPermissions=response.headers?.get('x-accepted-github-permissions')??null;throw err;}
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
  async createReviewedCommit(r,base,files,expectedTree){
   const parent=await request(r,'/git/commits/'+base);
   const entries=[];
   for(const file of files){const blob=await request(r,'/git/blobs',{method:'POST',body:{content:file.content,encoding:'base64'}});entries.push({path:file.path,mode:file.mode,type:'blob',sha:blob.sha});}
   const tree=await request(r,'/git/trees',{method:'POST',body:{base_tree:parent.tree.sha,tree:entries}});
   if(tree.sha!==expectedTree)throw Error('remote tree mismatch');
   const commit=await request(r,'/git/commits',{method:'POST',body:{message:'Factory independently reviewed patch',tree:tree.sha,parents:[base]}});
   if(!oid(commit.sha)||commit.tree.sha!==expectedTree||commit.parents.length!==1||commit.parents[0].sha!==base)throw Error('remote commit mismatch');
   return {sha:commit.sha,tree:tree.sha,parent:base};
  },
  async push(q,c){await request(q.repository,'/git/refs',{method:'POST',body:{ref:'refs/heads/'+q.branch,sha:c.sha}});},
  async findPRs(q){const owner=q.repository.split('/')[0];const rows=await pages(q.repository,'/pulls?state=all&head='+enc(owner+':'+q.branch));return rows.map(x=>({state:x.state,head:x.head.sha,base:x.base.sha,headBranch:x.head.ref,baseBranch:x.base.ref,repository:x.head.repo?.full_name,number:x.number,url:x.html_url}));},
  async createPR(q){return request(q.repository,'/pulls',{method:'POST',body:{head:q.branch,base:q.baseBranch,title:'Factory reviewed change '+q.branch.slice(-12),body:'Reviewed candidate; no automatic merge.',maintainer_can_modify:false}});},
  async checks(r,s){if(!oid(s))throw Error('invalid commit');const rows=await pages(r,'/commits/'+s+'/check-runs?filter=latest',x=>x.check_runs);return rows.map(x=>({name:x.name,sha:x.head_sha,id:x.id,conclusion:x.status==='completed'?x.conclusion:null}));}
 };
}

/** Uses B's trusted workspace helpers. No candidate code executes here. */
export function prepareRemotePatch({remote,repositoryPath,root,workspaceApi,signal}) {
 return async (spec,artifact)=>{
  const {createWorkspace,git,sourceFile,safePath}=workspaceApi??await import('./workspace.mjs');
  const {readFile,writeFile}=await import('node:fs/promises');
  const {join,dirname}=await import('node:path');
  const {mkdtemp,rm}=await import('node:fs/promises');
  const {workspace,cleanup}=await createWorkspace({root,repositoryPath,baseCommit:spec.baseCommit,signal});
  let temp;
  try{
   const before=new Map();
   for(const p of artifact.changedPaths){
    safePath(p);await sourceFile(workspace,p,signal);
    before.set(p,(await git(workspace,['ls-files','--stage','--',p],signal)).slice(0,6));
   }
   temp=await mkdtemp(join(dirname(workspace),'delivery-patch-'));
   const patchPath=join(temp,'reviewed.diff');await writeFile(patchPath,artifact.patch,{mode:0o600});
   await git(workspace,['apply','--index','--binary','--',patchPath],signal);
   const changed=(await git(workspace,['diff','--cached','--name-only','-z',spec.baseCommit,'--'],signal)).split('\0').filter(Boolean).sort();
   if(JSON.stringify(changed)!==JSON.stringify([...artifact.changedPaths].sort()))throw Error('applied path mismatch');
   if((await git(workspace,['write-tree'],signal)).trim()!==artifact.candidateTree)throw Error('applied tree mismatch');
   const files=[];
   for(const p of changed){
    const path=await sourceFile(workspace,p,signal);
    const mode=(await git(workspace,['ls-files','--stage','--',p],signal)).slice(0,6);
    if(mode!==before.get(p)||!['100644','100755'].includes(mode))throw Error('mode change forbidden');
    files.push({path:p,mode,content:(await readFile(path)).toString('base64')});
   }
   return await remote.createReviewedCommit(spec.repository,spec.baseCommit,files,artifact.candidateTree);
  }finally{try{if(temp)await rm(temp,{recursive:true,force:true});}finally{await cleanup();}}
 };
}

/** D owns the state and fencing contract; dependencies are injected for isolated tests. */
export async function deliverDurable({store,deliveryApi,taskId,owner,ttlMs=120000,clock=Date.now,allowlist,approvedVerifierIds,remote,prepare,baseBranch,requiredChecks,beforeFinish=async()=>{}}){
 const api=deliveryApi??await import('./attempt-store.mjs');
 const {getDelivery,reserveDelivery,finishDelivery}=api;
 const initial=await store.transact(state=>{
  const task=state.tasks.find(t=>t.id===taskId);
  const spec=Object.hasOwn(state.specs??{},taskId)?state.specs[taskId]:null;
  if(!spec||task?.state!=='accepted'||!allowlist.includes(spec.repository))throw Error('task not authorized and accepted');
  const artifact=JSON.parse(task.artifact);
  const review=(state.attempts??[]).find(a=>a.taskId===taskId&&a.attemptId===artifact.attemptId&&a.phase==='review'&&a.state==='passed'&&a.artifactSha256===hash(task.artifact));
  if(!review||!approvedVerifierIds.includes(review.owner))throw Error('independent review missing');
  const evidence=JSON.parse(review.evidence);
  if(evidence.version!==1||evidence.verifierId!==review.owner||!['live','acceptance'].includes(evidence.kind)||!evidence.commands?.length||evidence.commands.some(c=>c.status!=='passed'||c.exitCode!==0)||!Number.isSafeInteger(evidence.tests?.passed)||evidence.tests.passed<1||evidence.tests.failed!==0||evidence.tests.skipped!==0)throw Error('invalid independent evidence');
  const approval={...evidence,passed:true};validateArtifact(spec,artifact,approval);
  const key=deliveryKey(spec),existing=getDelivery(state,key);
  if(existing?.state==='delivered')return {existing};
  const lease=reserveDelivery(state,key,owner,clock(),ttlMs);
  return {spec,artifact,approval,key,lease,existing};
 });
 if(!initial.lease)return initial.existing??null;
 const {spec,artifact,approval,key,lease}=initial;
 const assertLease=()=>store.transact(state=>{
  const d=getDelivery(state,key);
  if(d?.state!=='delivering'||d.token!==lease.token||d.expiresAt<=clock())throw Error('stale delivery lease');
  const t=state.tasks.find(t=>t.id===taskId);
  if(t?.state!=='accepted'||hash(t.artifact)!==hash(JSON.stringify(artifact)))throw Error('accepted artifact changed');
 });
 let result;
 try{result=await deliver({spec,artifact,approval,remote,prepare,baseBranch,requiredChecks,allowlist,assertLease});}
 catch(error){
  await store.transact(state=>finishDelivery(state,key,lease.token,clock(),{state:'pending',repository:spec.repository,failure:error.status===403?'github-permission-denied':error.status===401?'github-authentication-failed':'delivery reconciliation required'}));
  throw error;
 }
 // Crash injection belongs to the trusted harness, outside the transaction.
 await beforeFinish(result);
 await store.transact(state=>finishDelivery(state,key,lease.token,clock(),result));
 return result;
}

/** Per-repository installation tokens, cached until shortly before expiry. */
export function githubAppTokenProvider({appId,installationId,privateKey,allowlist,fetchImpl=fetch,clock=Date.now}){
 if(!/^\d+$/.test(String(appId))||!/^\d+$/.test(String(installationId))||!privateKey||!Array.isArray(allowlist)||!allowlist.length)throw Error('invalid GitHub App configuration');
 const permissions={contents:'write',pull_requests:'write',issues:'read',checks:'read',metadata:'read'};
 const cache=new Map(),pending=new Map();
 const encode=x=>Buffer.from(JSON.stringify(x)).toString('base64url');
 async function mint(repository){
  const now=Math.floor(clock()/1000);
  const unsigned=encode({alg:'RS256',typ:'JWT'})+'.'+encode({iat:now-60,exp:now+540,iss:String(appId)});
  const jwt=unsigned+'.'+createSign('RSA-SHA256').update(unsigned).sign(privateKey,'base64url');
  const res=await fetchImpl('https://api.github.com/app/installations/'+installationId+'/access_tokens',{method:'POST',redirect:'error',signal:AbortSignal.timeout(15000),headers:{Authorization:'Bearer '+jwt,Accept:'application/vnd.github+json','Content-Type':'application/json','X-GitHub-Api-Version':'2022-11-28'},body:JSON.stringify({repositories:[repository.split('/')[1]],permissions})});
  if(!res.ok){const e=new Error('GitHub App token HTTP '+res.status);e.status=res.status;throw e;}
  const result=await res.json(),expires=Date.parse(result.expires_at);
  if(typeof result.token!=='string'||!result.token||!Number.isFinite(expires)||expires<=clock()+60000||Object.entries(permissions).some(([k,v])=>result.permissions?.[k]!==v)||!Array.isArray(result.repositories)||result.repositories.length!==1||result.repositories[0].full_name.toLowerCase()!==repository.toLowerCase())throw Error('GitHub App token scope mismatch');
  cache.set(repository,{token:result.token,expires});return result.token;
 }
 return async repository=>{
  if(!allowlist.includes(repository)||!/^[-\w.]+\/[-\w.]+$/.test(repository))throw Error('unauthorized repository');
  const hit=cache.get(repository);if(hit&&hit.expires>clock()+60000)return hit.token;
  if(!pending.has(repository))pending.set(repository,mint(repository).finally(()=>pending.delete(repository)));
  return pending.get(repository);
 };
}
